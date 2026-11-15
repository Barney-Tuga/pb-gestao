using System.Net;
using System.Net.Http.Json;
using PbGestao.Api.Artigos;

namespace PbGestao.Api.Tests;

public sealed class ArticleApiTests(PostgreSqlApiFactory factory)
    : IClassFixture<PostgreSqlApiFactory>
{
    [Fact]
    public async Task HealthIsAnonymousAndReportsProcessHealth()
    {
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task AnonymousWritesAreRejectedWithoutAntiforgeryToken()
    {
        using var client = factory.CreateClient();
        using var response = await client.PostAsJsonAsync("/auth/login",
            new { Email = "admin@example.invalid", Password = "incorrect" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ReadOnlyUserCannotCreateUnitsOrArticles()
    {
        using var client = await factory.CreateAuthenticatedClientAsync(
            "reader@example.invalid", "TestReader!Passw0rd-Only");
        var unit = new CreateUnitRequest("UN", "Unidade");
        var article = new CreateArticleRequest(
            "READ-1", "Artigo", Guid.NewGuid(), false,
            Enumerable.Range(1, 5).Select(level => new MarginInput(level, 10)).ToArray(),
            null, null, null);

        using var unitResponse = await client.PostAsJsonAsync("/api/units", unit);
        using var articleResponse = await client.PostAsJsonAsync("/api/articles", article);

        Assert.Equal(HttpStatusCode.Forbidden, unitResponse.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, articleResponse.StatusCode);
    }

    [Fact]
    public async Task ArticleWritesRequireAntiforgeryToken()
    {
        using var client = await factory.CreateAuthenticatedClientAsync(
            "admin@example.invalid", "TestAdmin!Passw0rd-Only");
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");

        using var response = await client.PostAsJsonAsync(
            "/api/units", new CreateUnitRequest("UN", "Unidade"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task AdminCanCreateArticleAndCalculateVatInclusivePrice()
    {
        using var client = await factory.CreateAuthenticatedClientAsync(
            "admin@example.invalid", "TestAdmin!Passw0rd-Only");
        var unit = await CreateUnitAsync(client, $"UN{Guid.NewGuid():N}"[..10], "Unidade");
        var code = $"GES-{Guid.NewGuid():N}";
        var articleResponse = await client.PostAsJsonAsync("/api/articles", new CreateArticleRequest(
            code, "Artigo de teste", unit.Id, true,
            Enumerable.Range(1, 5)
                .Select(level => new MarginInput(level, level == 1 ? 20m : 10m))
                .ToArray(),
            100m, "Categoria", "Marca"));
        Assert.Equal(HttpStatusCode.Created, articleResponse.StatusCode);
        var created = await articleResponse.Content.ReadFromJsonAsync<CreatedArticleResponse>();
        Assert.NotNull(created);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        using var missingVatResponse = await client.GetAsync(
            $"/api/articles/{created.Id}/prices/1?date={today:yyyy-MM-dd}");
        Assert.Equal(HttpStatusCode.Conflict, missingVatResponse.StatusCode);

        using var vatResponse = await client.PostAsJsonAsync(
            $"/api/articles/{created.Id}/vat-rates",
            new SetVatRateRequest(23m, today.AddDays(-1), null));
        Assert.Equal(HttpStatusCode.Created, vatResponse.StatusCode);

        var quote = await client.GetFromJsonAsync<PriceQuoteResponse>(
            $"/api/articles/{created.Id}/prices/1?date={today:yyyy-MM-dd}");

        Assert.NotNull(quote);
        Assert.Equal(147.60m, quote.PriceWithVat);
        Assert.Null(quote.UnavailableReason);
        using var quoteResponse = await client.GetAsync(
            $"/api/articles/{created.Id}/prices/1?date={today:yyyy-MM-dd}");
        var quoteJson = await quoteResponse.Content.ReadAsStringAsync();
        Assert.DoesNotContain("cost", quoteJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("margin", quoteJson, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task GescomCodesAreUniqueIgnoringCaseAndVatPeriodsCannotOverlap()
    {
        using var client = await factory.CreateAuthenticatedClientAsync(
            "admin@example.invalid", "TestAdmin!Passw0rd-Only");
        var unit = await CreateUnitAsync(client, $"UN{Guid.NewGuid():N}"[..10], "Unidade");
        var code = $"GES-{Guid.NewGuid():N}";
        var firstId = await CreateArticleAsync(client, code, unit.Id);
        using var duplicate = await client.PostAsJsonAsync("/api/articles",
            NewArticle(code.ToLowerInvariant(), unit.Id));
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);

        var from = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-10);
        using var firstRate = await client.PostAsJsonAsync(
            $"/api/articles/{firstId}/vat-rates",
            new SetVatRateRequest(23m, from, from.AddDays(20)));
        Assert.Equal(HttpStatusCode.Created, firstRate.StatusCode);

        using var overlapping = await client.PostAsJsonAsync(
            $"/api/articles/{firstId}/vat-rates",
            new SetVatRateRequest(6m, from.AddDays(10), null));
        Assert.Equal(HttpStatusCode.Conflict, overlapping.StatusCode);
    }

    private static async Task<UnitResponse> CreateUnitAsync(HttpClient client, string code, string name)
    {
        using var response = await client.PostAsJsonAsync("/api/units", new CreateUnitRequest(code, name));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<UnitResponse>())!;
    }

    private static async Task<Guid> CreateArticleAsync(HttpClient client, string code, Guid unitId)
    {
        using var response = await client.PostAsJsonAsync("/api/articles", NewArticle(code, unitId));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CreatedArticleResponse>())!.Id;
    }

    private static CreateArticleRequest NewArticle(string code, Guid unitId) =>
        new(code, "Artigo de teste", unitId, false,
            Enumerable.Range(1, 5).Select(level => new MarginInput(level, 10)).ToArray(),
            null, null, null);

    private sealed record CreatedArticleResponse(Guid Id);
}
