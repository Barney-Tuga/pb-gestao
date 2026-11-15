namespace PbGestao.Api.Artigos;

public sealed class ArticleCost
{
    public Guid Id { get; set; }
    public Guid ArticleId { get; set; }
    public Article Article { get; set; } = null!;
    public decimal Amount { get; set; }
    public DateTimeOffset ChangedAtUtc { get; set; }
    public string ChangedByUserId { get; set; } = string.Empty;
}
