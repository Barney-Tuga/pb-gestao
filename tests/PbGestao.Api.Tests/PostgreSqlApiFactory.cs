using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using PbGestao.Api.Auth;
using PbGestao.Api.Data;
using System.Net.Http.Json;

namespace PbGestao.Api.Tests;

public sealed class PostgreSqlApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly string _adminConnectionString =
        Environment.GetEnvironmentVariable("PB_TEST_ADMIN_CONNECTION_STRING")
        ?? throw new InvalidOperationException(
            "Set PB_TEST_ADMIN_CONNECTION_STRING to a local PostgreSQL connection string before running API integration tests.");

    private string _databaseName = $"pbgestao_test_{Guid.NewGuid():N}";
    private string _testConnectionString = string.Empty;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:DefaultConnection", _testConnectionString);
        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = _testConnectionString,
            });
        });
        builder.ConfigureLogging(logging => logging.AddConsole());
    }

    public async Task InitializeAsync()
    {
        var adminBuilder = new NpgsqlConnectionStringBuilder(_adminConnectionString)
        {
            Database = "postgres",
        };
        await using (var connection = new NpgsqlConnection(adminBuilder.ConnectionString))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"CREATE DATABASE \"{_databaseName}\"";
            await command.ExecuteNonQueryAsync();
        }

        _testConnectionString = new NpgsqlConnectionStringBuilder(_adminConnectionString)
        {
            Database = _databaseName,
        }.ConnectionString;

        var previousConnectionString =
            Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection");
        IServiceProvider services;
        try
        {
            Environment.SetEnvironmentVariable(
                "ConnectionStrings__DefaultConnection", _testConnectionString);
            services = Services;
        }
        finally
        {
            Environment.SetEnvironmentVariable(
                "ConnectionStrings__DefaultConnection", previousConnectionString);
        }

        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        if (!string.Equals(
                db.Database.GetDbConnection().Database,
                _databaseName,
                StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"The integration-test host is not connected to isolated database '{_databaseName}'.");
        }

        await db.Database.MigrateAsync();
        await IdentityBootstrap.CreateInitialAdminAsync(
            services, "admin@example.invalid", "TestAdmin!Passw0rd-Only");

        var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        var reader = new IdentityUser
        {
            UserName = "reader@example.invalid",
            Email = "reader@example.invalid",
            EmailConfirmed = true,
        };
        var created = await users.CreateAsync(reader, "TestReader!Passw0rd-Only");
        if (!created.Succeeded)
        {
            throw new InvalidOperationException("Could not create the read-only integration-test user.");
        }

        var assigned = await users.AddToRoleAsync(reader, Roles.User);
        if (!assigned.Succeeded)
        {
            throw new InvalidOperationException("Could not assign the integration-test user role.");
        }
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        await base.DisposeAsync();
        var adminBuilder = new NpgsqlConnectionStringBuilder(_adminConnectionString)
        {
            Database = "postgres",
        };
        await using var connection = new NpgsqlConnection(adminBuilder.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{_databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    public async Task<HttpClient> CreateAuthenticatedClientAsync(string email, string password)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions
        {
            HandleCookies = true,
            BaseAddress = new Uri("http://localhost"),
        });
        await AddAntiforgeryTokenAsync(client);
        using var response = await client.PostAsJsonAsync("/auth/login", new { Email = email, Password = password });
        response.EnsureSuccessStatusCode();
        await AddAntiforgeryTokenAsync(client);
        return client;
    }

    public static async Task AddAntiforgeryTokenAsync(HttpClient client)
    {
        using var response = await client.GetAsync("/auth/csrf");
        response.EnsureSuccessStatusCode();
        var setCookie = response.Headers.GetValues("Set-Cookie")
            .Single(value => value.StartsWith("XSRF-TOKEN=", StringComparison.Ordinal));
        var token = setCookie["XSRF-TOKEN=".Length..].Split(';')[0];
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(token));
    }
}
