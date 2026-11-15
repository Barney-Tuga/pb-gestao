namespace PbGestao.Api.Artigos;

public sealed class ArticlePriceMargin
{
    public Guid Id { get; set; }
    public Guid ArticleId { get; set; }
    public Article Article { get; set; } = null!;
    public int Level { get; set; }
    public decimal MarginPercent { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
    public string UpdatedByUserId { get; set; } = string.Empty;
}
