namespace PbGestao.Api.Artigos;

public sealed class ArticleVatRate
{
    public Guid Id { get; set; }
    public Guid ArticleId { get; set; }
    public Article Article { get; set; } = null!;
    public decimal RatePercent { get; set; }
    public DateOnly ValidFrom { get; set; }
    public DateOnly? ValidTo { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
    public string UpdatedByUserId { get; set; } = string.Empty;
}
