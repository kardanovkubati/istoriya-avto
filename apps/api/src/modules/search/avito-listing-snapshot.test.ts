import { describe, expect, it } from "bun:test";
import { parseAvitoListingSnapshotHtml } from "./avito-listing-snapshot";

describe("parseAvitoListingSnapshotHtml", () => {
  it("extracts public vehicle facts from JSON-LD without personal data", () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "LADA Granta, 2021",
            "image": ["https://static.example.test/photo.jpg"],
            "description": "Пробег 42 000 км. VIN XTA210990Y2765499. Телефон +7 900 123-45-67",
            "offers": { "@type": "Offer", "price": "780000", "priceCurrency": "RUB" }
          }
          </script>
        </head>
        <body>
          <span data-marker="item-view/item-address">Москва</span>
        </body>
      </html>
    `;

    expect(parseAvitoListingSnapshotHtml(html)).toEqual({
      status: "captured",
      data: {
        vin: "XTA210990Y2765499",
        title: "LADA Granta, 2021",
        make: "LADA",
        model: "Granta",
        year: 2021,
        bodyType: null,
        color: null,
        engine: null,
        transmission: null,
        driveType: null,
        priceRub: 780000,
        mileageKm: 42000,
        city: "Москва",
        photos: [{ url: "https://static.example.test/photo.jpg", alt: "Фото автомобиля" }]
      }
    });
    expect(JSON.stringify(parseAvitoListingSnapshotHtml(html))).not.toMatch(/\+7|900|123-45-67|Телефон/);
  });

  it("returns unavailable when the page has no public structured listing data", () => {
    expect(parseAvitoListingSnapshotHtml("<html><title>login</title></html>")).toEqual({
      status: "unavailable",
      reason: "structured_data_missing"
    });
  });
});
