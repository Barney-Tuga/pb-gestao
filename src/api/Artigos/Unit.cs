namespace PbGestao.Api.Artigos;

public sealed class Unit
{
    public Guid Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string NormalizedCode { get; private set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public string CreatedByUserId { get; set; } = string.Empty;
}
