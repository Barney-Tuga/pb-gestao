using System.Data;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PbGestao.Api.Auth;
using PbGestao.Api.Data;

namespace PbGestao.Api.Artigos;

public static class ArticleEndpoints
{
    public static void MapArticleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var api = endpoints.MapGroup("/api")
            .RequireAuthorization()
            .AddEndpointFilter<AntiforgeryEndpointFilter>();

        api.MapGet("/units", async (ApplicationDbContext db, CancellationToken cancellationToken) =>
        {
            var units = await db.Units.AsNoTracking()
                .OrderBy(unit => unit.Code)
                .Select(unit => new UnitResponse(unit.Id, unit.Code, unit.Name))
                .ToListAsync(cancellationToken);
            return Results.Ok(units);
        });

        api.MapPost("/units", async (
            CreateUnitRequest request,
            ApplicationDbContext db,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Code) || string.IsNullOrWhiteSpace(request.Name))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Code)] = ["Unit code and name are required."],
                });
            }

            if (request.Code.Trim().Length > 24 || request.Name.Trim().Length > 80)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Code)] = ["Unit code or name exceeds the allowed length."],
                });
            }

            var unit = new Unit
            {
                Id = Guid.NewGuid(),
                Code = request.Code.Trim(),
                Name = request.Name.Trim(),
                CreatedAtUtc = DateTimeOffset.UtcNow,
                CreatedByUserId = UserId(principal),
            };
            db.Units.Add(unit);

            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException exception) when (IsUniqueViolation(exception))
            {
                return Results.Conflict(new { error = "A unit with this code already exists." });
            }

            return Results.Created($"/api/units/{unit.Id}",
                new UnitResponse(unit.Id, unit.Code, unit.Name));
        }).RequireAuthorization(policy => policy.RequireRole(Roles.Admin));

        api.MapGet("/articles", async (
            string? search,
            int? page,
            int? pageSize,
            ApplicationDbContext db,
            CancellationToken cancellationToken) =>
        {
            var pageNumber = Math.Clamp(page ?? 1, 1, 1_000_000);
            var size = Math.Clamp(pageSize ?? 50, 1, 100);
            var query = db.Articles.AsNoTracking().Where(article => article.IsActive);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.Trim();
                query = query.Where(article =>
                    article.GescomCode.Contains(term) || article.Name.Contains(term));
            }

            var articles = await query
                .OrderBy(article => article.GescomCode)
                .Skip((pageNumber - 1) * size)
                .Take(size)
                .AsSplitQuery()
                .Include(article => article.Unit)
                .Include(article => article.Costs)
                .Include(article => article.PriceMargins)
                .Include(article => article.VatRates)
                .ToListAsync(cancellationToken);

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            return Results.Ok(articles.Select(article => ToSummary(article, today)).ToList());
        });

        api.MapGet("/articles/{id:guid}", async (
            Guid id,
            ApplicationDbContext db,
            CancellationToken cancellationToken) =>
        {
            var article = await LoadArticle(db, id, cancellationToken);
            return article is null || !article.IsActive
                ? Results.NotFound()
                : Results.Ok(ToSummary(article, DateOnly.FromDateTime(DateTime.UtcNow)));
        });

        api.MapGet("/articles/{id:guid}/prices/{level:int}", async (
            Guid id,
            int level,
            DateOnly? date,
            ApplicationDbContext db,
            CancellationToken cancellationToken) =>
        {
            if (level is < 1 or > 5)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(level)] = ["Price level must be between 1 and 5."],
                });
            }

            var article = await LoadArticle(db, id, cancellationToken);
            if (article is null || !article.IsActive)
            {
                return Results.NotFound();
            }

            var asOf = date ?? DateOnly.FromDateTime(DateTime.UtcNow);
            var quote = Quote(article, level, asOf);
            return quote.PriceWithVat is null
                ? Results.Conflict(new { error = quote.UnavailableReason })
                : Results.Ok(quote);
        });

        api.MapGet("/admin/articles", async (
            ApplicationDbContext db,
            CancellationToken cancellationToken) =>
        {
            var articles = await db.Articles.AsNoTracking()
                .OrderBy(article => article.GescomCode)
                .AsSplitQuery()
                .Include(article => article.Unit)
                .Include(article => article.Costs)
                .Include(article => article.PriceMargins)
                .Include(article => article.VatRates)
                .ToListAsync(cancellationToken);
            return Results.Ok(articles.Select(ToAdminDetails).ToList());
        }).RequireAuthorization(policy => policy.RequireRole(Roles.Admin));

        api.MapPost("/articles", async (
            CreateArticleRequest request,
            ApplicationDbContext db,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            var errors = ValidateArticle(
                request.GescomCode,
                request.Name,
                request.Margins,
                requireMargins: true,
                category: request.Category,
                brand: request.Brand);
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            if (!await db.Units.AnyAsync(unit => unit.Id == request.UnitId, cancellationToken))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.UnitId)] = ["The selected unit does not exist."],
                });
            }

            var now = DateTimeOffset.UtcNow;
            var userId = UserId(principal);
            var article = new Article
            {
                Id = Guid.NewGuid(),
                GescomCode = request.GescomCode.Trim(),
                Name = request.Name.Trim(),
                Category = NormalizeOptional(request.Category),
                Brand = NormalizeOptional(request.Brand),
                UnitId = request.UnitId,
                TracksLots = request.TracksLots,
                IsActive = true,
                CreatedAtUtc = now,
                CreatedByUserId = userId,
                UpdatedAtUtc = now,
                UpdatedByUserId = userId,
            };
            foreach (var margin in request.Margins!.OrderBy(value => value.Level))
            {
                article.PriceMargins.Add(new ArticlePriceMargin
                {
                    Id = Guid.NewGuid(),
                    ArticleId = article.Id,
                    Level = margin.Level,
                    MarginPercent = margin.MarginPercent,
                    UpdatedAtUtc = now,
                    UpdatedByUserId = userId,
                });
            }

            if (request.CostAmount is { } cost)
            {
                if (cost < 0 || !FitsNumeric18Scale4(cost))
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        [nameof(request.CostAmount)] = ["Cost must be non-negative and fit numeric(18,4)."],
                    });
                }

                    article.Costs.Add(NewCost(article.Id, cost, now, userId));
            }

            AddAudit(db, article, "ArticleCreated", new
            {
                article.GescomCode,
                article.Name,
                article.UnitId,
                article.TracksLots,
            }, now, userId);
            db.Articles.Add(article);

            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException exception) when (IsUniqueViolation(exception))
            {
                return Results.Conflict(new { error = "An article with this Gescom code already exists." });
            }

            return Results.Created($"/api/articles/{article.Id}", new { article.Id });
        }).RequireAuthorization(policy => policy.RequireRole(Roles.Admin));

        api.MapPut("/articles/{id:guid}", async (
            Guid id,
            UpdateArticleRequest request,
            ApplicationDbContext db,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            var errors = ValidateArticle(
                request.GescomCode,
                request.Name,
                margins: null,
                category: request.Category,
                brand: request.Brand);
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            var article = await db.Articles
                .Include(value => value.AuditEntries)
                .SingleOrDefaultAsync(value => value.Id == id, cancellationToken);
            if (article is null)
            {
                return Results.NotFound();
            }

            var before = new
            {
                article.GescomCode,
                article.Name,
                article.Category,
                article.Brand,
                article.TracksLots,
                article.IsActive,
            };
            article.GescomCode = request.GescomCode.Trim();
            article.Name = request.Name.Trim();
            article.Category = NormalizeOptional(request.Category);
            article.Brand = NormalizeOptional(request.Brand);
            article.TracksLots = request.TracksLots;
            article.IsActive = request.IsActive;
            article.UpdatedAtUtc = DateTimeOffset.UtcNow;
            article.UpdatedByUserId = UserId(principal);
            AddAudit(db, article, "ArticleUpdated", new { Before = before, After = new
            {
                article.GescomCode,
                article.Name,
                article.Category,
                article.Brand,
                article.TracksLots,
                article.IsActive,
            } }, article.UpdatedAtUtc, article.UpdatedByUserId);

            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException exception) when (IsUniqueViolation(exception))
            {
                return Results.Conflict(new { error = "An article with this Gescom code already exists." });
            }

            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole(Roles.Admin));

        api.MapPut("/articles/{id:guid}/cost", async (
            Guid id,
            SetArticleCostRequest request,
            ApplicationDbContext db,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (request.Amount < 0)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Amount)] = ["Cost cannot be negative."],
                });
            }

            if (!FitsNumeric18Scale4(request.Amount))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Amount)] = ["Cost must fit numeric(18,4)."],
                });
            }

            var article = await db.Articles
                .AsSplitQuery()
                .Include(value => value.Costs)
                .Include(value => value.AuditEntries)
                .SingleOrDefaultAsync(value => value.Id == id, cancellationToken);
            if (article is null)
            {
                return Results.NotFound();
            }

            var now = DateTimeOffset.UtcNow;
            var userId = UserId(principal);
            var previous = article.Costs.OrderByDescending(cost => cost.ChangedAtUtc)
                .Select(cost => (decimal?)cost.Amount)
                .FirstOrDefault();
            db.ArticleCosts.Add(NewCost(article.Id, request.Amount, now, userId));
            AddAudit(db, article, "CostUpdated", new { Previous = previous, Current = request.Amount }, now, userId);
            await db.SaveChangesAsync(cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole(Roles.Admin));

        api.MapPut("/articles/{id:guid}/margins/{level:int}", async (
            Guid id,
            int level,
            SetMarginRequest request,
            ApplicationDbContext db,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (level is < 1 or > 5)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(level)] = ["Price level must be between 1 and 5."],
                });
            }

            if (!FitsNumeric18Scale4(request.MarginPercent))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.MarginPercent)] = ["Margin must fit numeric(18,4)."],
                });
            }

            var margin = await db.ArticlePriceMargins
                .Include(value => value.Article)
                .ThenInclude(article => article.AuditEntries)
                .SingleOrDefaultAsync(value => value.ArticleId == id && value.Level == level, cancellationToken);
            if (margin is null)
            {
                return Results.NotFound();
            }

            var previous = margin.MarginPercent;
            var now = DateTimeOffset.UtcNow;
            var userId = UserId(principal);
            margin.MarginPercent = request.MarginPercent;
            margin.UpdatedAtUtc = now;
            margin.UpdatedByUserId = userId;
            AddAudit(db, margin.Article, "MarginUpdated",
                new { Level = level, Previous = previous, Current = request.MarginPercent }, now, userId);
            await db.SaveChangesAsync(cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole(Roles.Admin));

        api.MapPost("/articles/{id:guid}/vat-rates", async (
            Guid id,
            SetVatRateRequest request,
            ApplicationDbContext db,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            var errors = ValidateVatRate(request.RatePercent, request.ValidFrom, request.ValidTo);
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            await using var transaction = await db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);
            var article = await db.Articles
                .AsSplitQuery()
                .Include(value => value.VatRates)
                .Include(value => value.AuditEntries)
                .SingleOrDefaultAsync(value => value.Id == id, cancellationToken);
            if (article is null)
            {
                return Results.NotFound();
            }

            if (HasOverlappingVatRate(article.VatRates, request.ValidFrom, request.ValidTo))
            {
                return Results.Conflict(new { error = "VAT validity periods for an article cannot overlap." });
            }

            var now = DateTimeOffset.UtcNow;
            var userId = UserId(principal);
            var vatRate = new ArticleVatRate
            {
                Id = Guid.NewGuid(),
                ArticleId = id,
                RatePercent = request.RatePercent,
                ValidFrom = request.ValidFrom,
                ValidTo = request.ValidTo,
                UpdatedAtUtc = now,
                UpdatedByUserId = userId,
            };
            db.ArticleVatRates.Add(vatRate);
            AddAudit(db, article, "VatRateCreated", new
            {
                vatRate.RatePercent,
                vatRate.ValidFrom,
                vatRate.ValidTo,
            }, now, userId);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Results.Created($"/api/articles/{id}/vat-rates/{vatRate.Id}",
                new VatRateResponse(vatRate.Id, vatRate.RatePercent, vatRate.ValidFrom, vatRate.ValidTo));
        }).RequireAuthorization(policy => policy.RequireRole(Roles.Admin));

        api.MapPut("/articles/{id:guid}/vat-rates/{vatRateId:guid}", async (
            Guid id,
            Guid vatRateId,
            SetVatRateRequest request,
            ApplicationDbContext db,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            var errors = ValidateVatRate(request.RatePercent, request.ValidFrom, request.ValidTo);
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            await using var transaction = await db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);
            var article = await db.Articles
                .AsSplitQuery()
                .Include(value => value.VatRates)
                .Include(value => value.AuditEntries)
                .SingleOrDefaultAsync(value => value.Id == id, cancellationToken);
            if (article is null)
            {
                return Results.NotFound();
            }

            var vatRate = article.VatRates.SingleOrDefault(value => value.Id == vatRateId);
            if (vatRate is null)
            {
                return Results.NotFound();
            }

            if (HasOverlappingVatRate(article.VatRates, request.ValidFrom, request.ValidTo, vatRateId))
            {
                return Results.Conflict(new { error = "VAT validity periods for an article cannot overlap." });
            }

            var before = new { vatRate.RatePercent, vatRate.ValidFrom, vatRate.ValidTo };
            vatRate.RatePercent = request.RatePercent;
            vatRate.ValidFrom = request.ValidFrom;
            vatRate.ValidTo = request.ValidTo;
            vatRate.UpdatedAtUtc = DateTimeOffset.UtcNow;
            vatRate.UpdatedByUserId = UserId(principal);
            AddAudit(db, article, "VatRateUpdated", new
            {
                Before = before,
                After = new { vatRate.RatePercent, vatRate.ValidFrom, vatRate.ValidTo },
            }, vatRate.UpdatedAtUtc, vatRate.UpdatedByUserId);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole(Roles.Admin));
    }

    private static async Task<Article?> LoadArticle(
        ApplicationDbContext db,
        Guid id,
        CancellationToken cancellationToken) =>
        await db.Articles.AsNoTracking()
            .AsSplitQuery()
            .Include(article => article.Unit)
            .Include(article => article.Costs)
            .Include(article => article.PriceMargins)
            .Include(article => article.VatRates)
            .SingleOrDefaultAsync(article => article.Id == id, cancellationToken);

    private static ArticleSummaryResponse ToSummary(Article article, DateOnly asOf)
    {
        var prices = Enumerable.Range(1, 5)
            .Select(level => Quote(article, level, asOf))
            .ToList();
        return new ArticleSummaryResponse(
            article.Id,
            article.GescomCode,
            article.Name,
            article.Category,
            article.Brand,
            article.Unit.Code,
            article.Unit.Name,
            article.TracksLots,
            article.IsActive,
            asOf,
            prices);
    }

    private static ArticleAdminResponse ToAdminDetails(Article article)
    {
        var cost = article.Costs.OrderByDescending(value => value.ChangedAtUtc).FirstOrDefault();
        return new ArticleAdminResponse(
            article.Id,
            article.GescomCode,
            article.Name,
            article.Category,
            article.Brand,
            article.UnitId,
            article.Unit.Code,
            article.Unit.Name,
            article.TracksLots,
            article.IsActive,
            cost is null ? null : new CostResponse(cost.Amount, cost.ChangedAtUtc, cost.ChangedByUserId),
            article.PriceMargins.OrderBy(value => value.Level)
                .Select(value => new MarginResponse(
                    value.Level, value.MarginPercent, value.UpdatedAtUtc, value.UpdatedByUserId))
                .ToList(),
            article.VatRates.OrderBy(value => value.ValidFrom)
                .Select(value => new VatRateResponse(
                    value.Id, value.RatePercent, value.ValidFrom, value.ValidTo))
                .ToList());
    }

    private static PriceQuoteResponse Quote(Article article, int level, DateOnly asOf)
    {
        var cost = article.Costs.OrderByDescending(value => value.ChangedAtUtc).FirstOrDefault();
        if (cost is null)
        {
            return new PriceQuoteResponse(level, asOf, null, "A commercial cost has not been configured.");
        }

        var margin = article.PriceMargins.SingleOrDefault(value => value.Level == level);
        if (margin is null)
        {
            return new PriceQuoteResponse(level, asOf, null, "The margin for this price level has not been configured.");
        }

        var vatRate = article.VatRates.SingleOrDefault(value =>
            value.ValidFrom <= asOf && (value.ValidTo is null || asOf < value.ValidTo));
        if (vatRate is null)
        {
            return new PriceQuoteResponse(level, asOf, null, "No VAT rate is configured for this date.");
        }

        decimal price;
        try
        {
            price = ArticlePricingService.CalculatePriceWithVat(
                cost.Amount, margin.MarginPercent, vatRate.RatePercent);
        }
        catch (OverflowException)
        {
            return new PriceQuoteResponse(level, asOf, null, "The configured price exceeds the supported range.");
        }

        if (price < 0)
        {
            return new PriceQuoteResponse(level, asOf, null, "The configured price would be negative.");
        }

        return new PriceQuoteResponse(level, asOf, price, null);
    }

    private static Dictionary<string, string[]> ValidateArticle(
        string? gescomCode,
        string? name,
        IReadOnlyCollection<MarginInput>? margins,
        bool requireMargins = false,
        string? category = null,
        string? brand = null)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(gescomCode) || gescomCode.Trim().Length > 80)
        {
            errors[nameof(gescomCode)] = ["A Gescom code of at most 80 characters is required."];
        }

        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 200)
        {
            errors[nameof(name)] = ["An article name of at most 200 characters is required."];
        }

        if (margins is not null || requireMargins)
        {
            if (margins is null ||
                margins.Count != 5 ||
                margins.Select(value => value.Level).Order().SequenceEqual(new[] { 1, 2, 3, 4, 5 }) is false)
            {
                errors[nameof(margins)] = ["Exactly one margin for each price level from 1 to 5 is required."];
            }
            else if (margins.Any(value => !FitsNumeric18Scale4(value.MarginPercent)))
            {
                errors[nameof(margins)] = ["Each margin must fit numeric(18,4)."];
            }
        }

        if (category?.Trim().Length > 100)
        {
            errors[nameof(category)] = ["Category must be at most 100 characters."];
        }

        if (brand?.Trim().Length > 100)
        {
            errors[nameof(brand)] = ["Brand must be at most 100 characters."];
        }

        return errors;
    }

    private static Dictionary<string, string[]> ValidateVatRate(
        decimal ratePercent,
        DateOnly validFrom,
        DateOnly? validTo)
    {
        var errors = new Dictionary<string, string[]>();
        if (ratePercent < 0 || !FitsNumeric18Scale4(ratePercent))
        {
            errors[nameof(ratePercent)] = ["VAT rate must be non-negative and fit numeric(18,4)."];
        }

        if (validTo is not null && validTo <= validFrom)
        {
            errors[nameof(validTo)] = ["The end date must be later than the start date."];
        }

        return errors;
    }

    private static bool HasOverlappingVatRate(
        IEnumerable<ArticleVatRate> rates,
        DateOnly validFrom,
        DateOnly? validTo,
        Guid? exceptId = null) =>
        rates.Any(rate =>
            rate.Id != exceptId &&
            (validTo is null || rate.ValidFrom < validTo) &&
            (rate.ValidTo is null || rate.ValidTo > validFrom));

    private static ArticleCost NewCost(Guid articleId, decimal amount, DateTimeOffset now, string userId) =>
        new()
        {
            Id = Guid.NewGuid(),
            ArticleId = articleId,
            Amount = amount,
            ChangedAtUtc = now,
            ChangedByUserId = userId,
        };

    private static void AddAudit(
        ApplicationDbContext db,
        Article article,
        string eventType,
        object details,
        DateTimeOffset changedAtUtc,
        string userId) =>
        db.ArticleAuditEntries.Add(new ArticleAuditEntry
        {
            Id = Guid.NewGuid(),
            ArticleId = article.Id,
            EventType = eventType,
            DetailsJson = JsonSerializer.Serialize(details),
            ChangedAtUtc = changedAtUtc,
            ChangedByUserId = userId,
        });

    private static string UserId(ClaimsPrincipal principal) =>
        principal.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? throw new InvalidOperationException("Authenticated user has no identifier.");

    private static string? NormalizeOptional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static bool FitsNumeric18Scale4(decimal value) =>
        value == decimal.Round(value, 4) &&
        value <= 99_999_999_999_999.9999m &&
        value >= -99_999_999_999_999.9999m;

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
        };
}

public sealed record CreateUnitRequest(string Code, string Name);
public sealed record UnitResponse(Guid Id, string Code, string Name);
public sealed record MarginInput(int Level, decimal MarginPercent);
public sealed record CreateArticleRequest(
    string GescomCode,
    string Name,
    Guid UnitId,
    bool TracksLots,
    IReadOnlyList<MarginInput> Margins,
    decimal? CostAmount,
    string? Category,
    string? Brand);
public sealed record UpdateArticleRequest(
    string GescomCode,
    string Name,
    bool TracksLots,
    bool IsActive,
    string? Category,
    string? Brand);
public sealed record SetArticleCostRequest(decimal Amount);
public sealed record SetMarginRequest(decimal MarginPercent);
public sealed record SetVatRateRequest(decimal RatePercent, DateOnly ValidFrom, DateOnly? ValidTo);
public sealed record PriceQuoteResponse(int Level, DateOnly AsOf, decimal? PriceWithVat, string? UnavailableReason);
public sealed record ArticleSummaryResponse(
    Guid Id,
    string GescomCode,
    string Name,
    string? Category,
    string? Brand,
    string UnitCode,
    string UnitName,
    bool TracksLots,
    bool IsActive,
    DateOnly PricesAsOf,
    IReadOnlyList<PriceQuoteResponse> Prices);
public sealed record CostResponse(decimal Amount, DateTimeOffset ChangedAtUtc, string ChangedByUserId);
public sealed record MarginResponse(
    int Level,
    decimal MarginPercent,
    DateTimeOffset UpdatedAtUtc,
    string UpdatedByUserId);
public sealed record VatRateResponse(Guid Id, decimal RatePercent, DateOnly ValidFrom, DateOnly? ValidTo);
public sealed record ArticleAdminResponse(
    Guid Id,
    string GescomCode,
    string Name,
    string? Category,
    string? Brand,
    Guid UnitId,
    string UnitCode,
    string UnitName,
    bool TracksLots,
    bool IsActive,
    CostResponse? Cost,
    IReadOnlyList<MarginResponse> Margins,
    IReadOnlyList<VatRateResponse> VatRates);
