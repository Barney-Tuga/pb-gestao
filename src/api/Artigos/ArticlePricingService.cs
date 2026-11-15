namespace PbGestao.Api.Artigos;

public static class ArticlePricingService
{
    public static decimal CalculatePriceWithoutVat(decimal cost, decimal marginPercent) =>
        cost * (1m + marginPercent / 100m);

    public static decimal CalculatePriceWithVat(
        decimal cost,
        decimal marginPercent,
        decimal vatPercent)
    {
        var priceWithoutVat = CalculatePriceWithoutVat(cost, marginPercent);
        return decimal.Round(
            priceWithoutVat * (1m + vatPercent / 100m),
            2,
            MidpointRounding.AwayFromZero);
    }
}
