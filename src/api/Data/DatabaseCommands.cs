using System.Net;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PbGestao.Api.Auth;

namespace PbGestao.Api.Data;

public static class DatabaseCommands
{
    public static async Task<bool> TryRunAsync(
        string[] args,
        IServiceProvider services,
        CancellationToken cancellationToken = default)
    {
        var migrate = args.Contains("--migrate-database", StringComparer.Ordinal);
        var bootstrap = args.Contains("--bootstrap-admin", StringComparer.Ordinal);
        var resetAdminPassword = args.Contains("--reset-admin-password", StringComparer.Ordinal);
        if (!migrate && !bootstrap && !resetAdminPassword)
        {
            return false;
        }

        if (new[] { migrate, bootstrap, resetAdminPassword }.Count(command => command) > 1)
        {
            throw new InvalidOperationException(
                "Run database maintenance commands separately.");
        }

        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        if (migrate)
        {
            await db.Database.MigrateAsync(cancellationToken);
            return true;
        }

        if (resetAdminPassword)
        {
            var environment = scope.ServiceProvider.GetRequiredService<IHostEnvironment>();
            if (!environment.IsDevelopment())
            {
                throw new InvalidOperationException(
                    "The administrator password reset command is available only in Development.");
            }

            var connectionString = new NpgsqlConnectionStringBuilder(
                db.Database.GetConnectionString());
            var databaseHost = connectionString.Host;
            if (string.IsNullOrWhiteSpace(databaseHost) || !IsLoopbackHost(databaseHost))
            {
                throw new InvalidOperationException(
                    "The administrator password reset command requires a loopback database host.");
            }

            var newPassword = Environment.GetEnvironmentVariable("PB_ADMIN_RESET_PASSWORD");
            if (string.IsNullOrEmpty(newPassword))
            {
                throw new InvalidOperationException(
                    "Set PB_ADMIN_RESET_PASSWORD in the process environment for this command.");
            }

            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
            var admins = await userManager.GetUsersInRoleAsync(Roles.Admin);
            if (admins.Count != 1)
            {
                throw new InvalidOperationException(
                    "The reset command requires exactly one existing administrator.");
            }

            var resetToken = await userManager.GeneratePasswordResetTokenAsync(admins[0]);
            var resetResult = await userManager.ResetPasswordAsync(admins[0], resetToken, newPassword);
            if (!resetResult.Succeeded)
            {
                var errorCodes = string.Join(", ", resetResult.Errors.Select(error => error.Code));
                throw new InvalidOperationException(
                    $"The configured Identity policy rejected the password reset: {errorCodes}");
            }

            Console.WriteLine("The existing administrator password was reset.");
            return true;
        }

        var pendingMigrations = await db.Database.GetPendingMigrationsAsync(cancellationToken);
        if (pendingMigrations.Any())
        {
            throw new InvalidOperationException(
                "Apply database migrations before bootstrapping the administrator.");
        }

        var email = Environment.GetEnvironmentVariable("PB_BOOTSTRAP_ADMIN_EMAIL");
        var password = Environment.GetEnvironmentVariable("PB_BOOTSTRAP_ADMIN_PASSWORD");
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrEmpty(password))
        {
            throw new InvalidOperationException(
                "Set PB_BOOTSTRAP_ADMIN_EMAIL and PB_BOOTSTRAP_ADMIN_PASSWORD for this one-time command.");
        }

        await IdentityBootstrap.CreateInitialAdminAsync(services, email.Trim(), password, cancellationToken);
        return true;
    }

    private static bool IsLoopbackHost(string host) =>
        string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
        (IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address));
}
