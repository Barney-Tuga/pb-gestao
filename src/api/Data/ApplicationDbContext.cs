using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using PbGestao.Api.Artigos;
using PbGestao.Api.Cadastros;

namespace PbGestao.Api.Data;

public sealed class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
    : IdentityDbContext<IdentityUser>(options)
{
    public DbSet<Article> Articles => Set<Article>();
    public DbSet<Unit> Units => Set<Unit>();
    public DbSet<ArticleCost> ArticleCosts => Set<ArticleCost>();
    public DbSet<ArticlePriceMargin> ArticlePriceMargins => Set<ArticlePriceMargin>();
    public DbSet<ArticleVatRate> ArticleVatRates => Set<ArticleVatRate>();
    public DbSet<ArticleAuditEntry> ArticleAuditEntries => Set<ArticleAuditEntry>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Supplier> Suppliers => Set<Supplier>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Article>(entity =>
        {
            entity.Property(article => article.GescomCode).HasMaxLength(80).IsRequired();
            entity.Property(article => article.NormalizedGescomCode)
                .HasComputedColumnSql("upper(btrim(\"GescomCode\"))", stored: true);
            entity.HasIndex(article => article.NormalizedGescomCode).IsUnique();
            entity.Property(article => article.Name).HasMaxLength(200).IsRequired();
            entity.Property(article => article.Category).HasMaxLength(100);
            entity.Property(article => article.Brand).HasMaxLength(100);
            entity.HasOne(article => article.Unit)
                .WithMany()
                .HasForeignKey(article => article.UnitId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<Unit>(entity =>
        {
            entity.Property(unit => unit.Code).HasMaxLength(24).IsRequired();
            entity.Property(unit => unit.Name).HasMaxLength(80).IsRequired();
            entity.Property(unit => unit.NormalizedCode)
                .HasComputedColumnSql("upper(btrim(\"Code\"))", stored: true);
            entity.HasIndex(unit => unit.NormalizedCode).IsUnique();
        });

        builder.Entity<ArticleCost>(entity =>
        {
            entity.Property(cost => cost.Amount).HasPrecision(18, 4);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_ArticleCosts_NonnegativeAmount",
                "\"Amount\" >= 0"));
            entity.HasIndex(cost => new { cost.ArticleId, cost.ChangedAtUtc });
            entity.HasOne(cost => cost.Article)
                .WithMany(article => article.Costs)
                .HasForeignKey(cost => cost.ArticleId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<ArticlePriceMargin>(entity =>
        {
            entity.Property(margin => margin.MarginPercent).HasPrecision(18, 4);
            entity.HasIndex(margin => new { margin.ArticleId, margin.Level }).IsUnique();
            entity.HasOne(margin => margin.Article)
                .WithMany(article => article.PriceMargins)
                .HasForeignKey(margin => margin.ArticleId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<ArticleVatRate>(entity =>
        {
            entity.Property(rate => rate.RatePercent).HasPrecision(18, 4);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_ArticleVatRates_ValidRange",
                    "\"ValidTo\" IS NULL OR \"ValidTo\" > \"ValidFrom\"");
                table.HasCheckConstraint(
                    "CK_ArticleVatRates_NonnegativeRate",
                    "\"RatePercent\" >= 0");
            });
            entity.HasIndex(rate => new { rate.ArticleId, rate.ValidFrom });
            entity.HasOne(rate => rate.Article)
                .WithMany(article => article.VatRates)
                .HasForeignKey(rate => rate.ArticleId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<ArticleAuditEntry>(entity =>
        {
            entity.Property(entry => entry.EventType).HasMaxLength(80).IsRequired();
            entity.Property(entry => entry.DetailsJson).HasColumnType("jsonb");
            entity.Property(entry => entry.ChangedByUserId).HasMaxLength(450).IsRequired();
            entity.HasIndex(entry => new { entry.ArticleId, entry.ChangedAtUtc });
            entity.HasOne(entry => entry.Article)
                .WithMany(article => article.AuditEntries)
                .HasForeignKey(entry => entry.ArticleId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<Customer>(entity =>
        {
            entity.Property(customer => customer.Name).HasMaxLength(200).IsRequired();
            entity.Property(customer => customer.TaxNumber).HasMaxLength(32);
            entity.Property(customer => customer.Email).HasMaxLength(256);
            entity.Property(customer => customer.Phone).HasMaxLength(32);
            entity.Property(customer => customer.CreatedByUserId).HasMaxLength(450).IsRequired();
            entity.Property(customer => customer.UpdatedByUserId).HasMaxLength(450).IsRequired();
        });

        builder.Entity<Supplier>(entity =>
        {
            entity.Property(supplier => supplier.Name).HasMaxLength(200).IsRequired();
            entity.Property(supplier => supplier.TaxNumber).HasMaxLength(32);
            entity.Property(supplier => supplier.Email).HasMaxLength(256);
            entity.Property(supplier => supplier.Phone).HasMaxLength(32);
            entity.Property(supplier => supplier.CreatedByUserId).HasMaxLength(450).IsRequired();
            entity.Property(supplier => supplier.UpdatedByUserId).HasMaxLength(450).IsRequired();
        });
    }
}
