import type { ReportPresentation } from "./report-presentation";

export function renderReportPdf(input: {
  title: string;
  presentation: ReportPresentation;
}): Uint8Array {
  const lines = [
    "Istoriya Avto",
    input.title,
    input.presentation.watermark,
    input.presentation.disclaimer,
    ...input.presentation.sections.flatMap((section) => [
      section.title,
      ...(section.state === "empty"
        ? [section.emptyText ?? "No data"]
        : section.items.map((item) => `${item.label}: ${item.value}`))
    ])
  ].map(toPdfSafeText);

  return buildSimplePdf(lines);
}

function buildSimplePdf(lines: string[]): Uint8Array {
  const content = [
    "BT",
    "/F1 12 Tf",
    "50 790 Td",
    ...lines.slice(0, 42).flatMap((line, index) => [
      index === 0 ? "" : "0 -17 Td",
      `(${escapePdfString(line)}) Tj`
    ]).filter(Boolean),
    "ET"
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

function escapePdfString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function toPdfSafeText(value: string): string {
  return value
    .replaceAll("История Авто", "Istoriya Avto")
    .replaceAll("·", "-")
    .replaceAll("₽", "RUB")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\?{3,}/g, "...");
}
