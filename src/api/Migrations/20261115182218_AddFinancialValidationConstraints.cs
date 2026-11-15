using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PbGestao.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFinancialValidationConstraints : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddCheckConstraint(
                name: "CK_ArticleVatRates_NonnegativeRate",
                table: "ArticleVatRates",
                sql: "\"RatePercent\" >= 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ArticleCosts_NonnegativeAmount",
                table: "ArticleCosts",
                sql: "\"Amount\" >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_ArticleVatRates_NonnegativeRate",
                table: "ArticleVatRates");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ArticleCosts_NonnegativeAmount",
                table: "ArticleCosts");
        }
    }
}
