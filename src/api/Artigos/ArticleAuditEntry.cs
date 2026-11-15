namespace PbGestao.Api.Artigos;

public sealed class ArticleAuditEntry
{
    public Guid Id { get; set; }
    public Guid ArticleId { get; set; }
    public Article Article { get; set; } = null!;
    public string EventType { get; set; } = string.Empty;
    public string DetailsJson { get; set; } = "{}";
    public DateTimeOffset ChangedAtUtc { get; set; }
    public string ChangedByUserId { get; set; } = string.Empty;
}
