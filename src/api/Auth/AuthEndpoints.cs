using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using PbGestao.Api.Data;

namespace PbGestao.Api.Auth;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var auth = endpoints.MapGroup("/auth");

        auth.MapGet("/csrf", (HttpContext context, IAntiforgery antiforgery) =>
        {
            var tokens = antiforgery.GetAndStoreTokens(context);
            context.Response.Cookies.Append("XSRF-TOKEN", tokens.RequestToken!, new CookieOptions
            {
                HttpOnly = false,
                IsEssential = true,
                Path = "/",
                SameSite = SameSiteMode.Strict,
                Secure = context.Request.IsHttps,
            });
            context.Response.Headers.CacheControl = "no-store";
            return Results.NoContent();
        }).AllowAnonymous();

        auth.MapPost("/login", async (
            LoginRequest request,
            SignInManager<IdentityUser> signInManager,
            UserManager<IdentityUser> userManager) =>
        {
            if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrEmpty(request.Password))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Email)] = ["Email and password are required."],
                });
            }

            var user = await userManager.FindByEmailAsync(request.Email.Trim());
            if (user is null)
            {
                return Results.Unauthorized();
            }

            var result = await signInManager.CheckPasswordSignInAsync(
                user,
                request.Password,
                lockoutOnFailure: true);
            if (!result.Succeeded)
            {
                return Results.Unauthorized();
            }

            await signInManager.SignInAsync(user, isPersistent: false);
            return Results.NoContent();
        })
        .AllowAnonymous()
        .AddEndpointFilter<AntiforgeryEndpointFilter>()
        .RequireRateLimiting("login");

        auth.MapGet("/me", async (
            ClaimsPrincipal principal,
            UserManager<IdentityUser> userManager) =>
        {
            var user = await userManager.GetUserAsync(principal);
            return user is null
                ? Results.Unauthorized()
                : Results.Ok(new CurrentUserResponse(
                    user.Email ?? user.UserName ?? string.Empty,
                    principal.IsInRole(Roles.Admin)));
        }).RequireAuthorization();

        auth.MapPost("/logout", async (SignInManager<IdentityUser> signInManager) =>
        {
            await signInManager.SignOutAsync();
            return Results.NoContent();
        })
        .RequireAuthorization()
        .AddEndpointFilter<AntiforgeryEndpointFilter>();

        auth.MapPost("/users", async (
            CreateUserRequest request,
            UserManager<IdentityUser> userManager,
            ApplicationDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrEmpty(request.Password))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Email)] = ["Email and password are required."],
                });
            }

            await using var transaction = await db.Database.BeginTransactionAsync();
            var user = new IdentityUser
            {
                UserName = request.Email.Trim(),
                Email = request.Email.Trim(),
                EmailConfirmed = true,
            };
            var createResult = await userManager.CreateAsync(user, request.Password);
            if (!createResult.Succeeded)
            {
                return Results.ValidationProblem(createResult.Errors
                    .GroupBy(error => error.Code)
                    .ToDictionary(
                        group => group.Key,
                        group => group.Select(error => error.Description).ToArray()));
            }

            var role = request.IsAdmin ? Roles.Admin : Roles.User;
            var roleResult = await userManager.AddToRoleAsync(user, role);
            if (!roleResult.Succeeded)
            {
                return Results.Problem(
                    "The account was not assigned a role.",
                    statusCode: StatusCodes.Status500InternalServerError);
            }

            await transaction.CommitAsync();
            return Results.Ok(
                new CreatedUserResponse(user.Id, user.Email!, request.IsAdmin));
        })
        .RequireAuthorization(policy => policy.RequireRole(Roles.Admin))
        .AddEndpointFilter<AntiforgeryEndpointFilter>();
    }
}

public sealed record LoginRequest(string Email, string Password);
public sealed record CurrentUserResponse(string Email, bool IsAdmin);
public sealed record CreateUserRequest(string Email, string Password, bool IsAdmin);
public sealed record CreatedUserResponse(string Id, string Email, bool IsAdmin);
