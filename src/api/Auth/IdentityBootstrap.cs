using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PbGestao.Api.Data;

namespace PbGestao.Api.Auth;

public static class IdentityBootstrap
{
    public static async Task CreateInitialAdminAsync(
        IServiceProvider services,
        string email,
        string password,
        CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        if (await db.Users.AnyAsync(cancellationToken))
        {
            throw new InvalidOperationException(
                "Bootstrap is allowed only when the user store is empty.");
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
        foreach (var role in new[] { Roles.Admin, Roles.User })
        {
            if (!await roleManager.RoleExistsAsync(role))
            {
                var roleResult = await roleManager.CreateAsync(new IdentityRole(role));
                EnsureSucceeded(roleResult, "Could not create the initial role.");
            }
        }

        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        var user = new IdentityUser
        {
            UserName = email,
            Email = email,
            EmailConfirmed = true,
        };
        EnsureSucceeded(await userManager.CreateAsync(user, password),
            "Could not create the initial administrator.");
        EnsureSucceeded(await userManager.AddToRoleAsync(user, Roles.Admin),
            "Could not assign the initial administrator role.");
        await transaction.CommitAsync(cancellationToken);
    }

    private static void EnsureSucceeded(IdentityResult result, string message)
    {
        if (!result.Succeeded)
        {
            var errors = string.Join("; ", result.Errors.Select(error => error.Code));
            throw new InvalidOperationException($"{message} Identity errors: {errors}");
        }
    }
}
