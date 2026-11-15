using PbGestao.Api.Artigos;

namespace PbGestao.Api.Tests;

public sealed class ArticlePricingServiceTests
{
    [Theory]
    [InlineData(100, 20, 23, 147.60)]
    [InlineData(19.99, 0, 0, 19.99)]
    [InlineData(100, 10, 5, 115.50)]
    public void AppliesMarkupThenVatAndRoundsDisplayedPrice(
        decimal cost,
        decimal marginPercent,
        decimal vatPercent,
        decimal expected)
    {
        var actual = ArticlePricingService.CalculatePriceWithVat(cost, marginPercent, vatPercent);

        Assert.Equal(expected, actual);
    }

    [Fact]
    public void RoundsMidpointsAwayFromZero()
    {
        var positive = ArticlePricingService.CalculatePriceWithVat(1, 0, 0.5m);
        var negative = ArticlePricingService.CalculatePriceWithVat(-1, 0, 0.5m);

        Assert.Equal(1.01m, positive);
        Assert.Equal(-1.01m, negative);
    }
}
