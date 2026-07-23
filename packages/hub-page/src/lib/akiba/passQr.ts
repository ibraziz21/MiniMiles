// Shared Pass QR rendering — extracted from AkibaPassCard.tsx so the compact
// home card, the full-screen /pass page, and /welcome's QR reveal slide all
// draw the identical code (same payload format, same visual style).
import QRCode from "qrcode";

export function qrPayload(passId: string) {
  return `akiba-pass:v1:${passId}`;
}

export function drawPassQr(canvas: HTMLCanvasElement, payload: string, width = 220) {
  return QRCode.toCanvas(canvas, payload, {
    width,
    margin: 2,
    color: { dark: "#0D3349", light: "#FFFFFF" },
    errorCorrectionLevel: "M",
  });
}
