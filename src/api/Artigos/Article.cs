namespace PbGestao.Api.Artigos;

public sealed class Article
{
    public Guid Id { get; set; }
    public string GescomCode { get; set; } = string.Empty;
    public string NormalizedGescomCode { get; private set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Category { get; set; }
    public string? Brand { get; set; }
    public Guid UnitId { get; set; }
    public Unit Unit { get; set; } = null!;
    public bool TracksLots { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public string CreatedByUserId { get; set; } = string.Empty;
    public DateTimeOffset UpdatedAtUtc { get; set; }
    public string UpdatedByUserId { get; set; } = string.Empty;
    public List<ArticleCost> Costs { get; set; } = [];
    public List<ArticlePriceMargin> PriceMargins { get; set; } = [];
    public List<ArticleVatRate> VatRates { get; set; } = [];
    public List<ArticleAuditEntry> AuditEntries { get; set; } = [];
}
