export const CANONICAL_APP_URL = "https://dajiaohuang.github.io/solar/";
export const CATALOG_DATA_ROOT =
  (typeof __SOLAR_DATA_ROOT__ !== "undefined" && __SOLAR_DATA_ROOT__) ||
  `${import.meta.env.BASE_URL}data/asteroids`;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function shareSceneUrl(url: string, title = "Solar Atlas") {
  void title;
  await navigator.clipboard.writeText(url);
  return "copied" as const;
}

export async function saveExport(blob: Blob, filename: string) {
  downloadBlob(blob, filename);
}

export function saveTextExport(
  content: string,
  filename: string,
  mimeType: string,
) {
  return saveExport(new Blob([content], { type: mimeType }), filename);
}

/** Serialize a large top-level record array a bounded batch at a time, avoiding
 * one full-size JSON string in the JavaScript heap. Blob storage remains browser-managed. */
export function saveJsonArrayExport(
  metadata: Record<string, unknown>,
  key: string,
  records: Iterable<unknown>,
  filename: string,
  recordsPerPull = 64,
) {
  if (
    !/^[A-Za-z_$][\w$]*$/.test(key) ||
    Object.hasOwn(metadata, key) ||
    !Number.isSafeInteger(recordsPerPull) ||
    recordsPerPull < 1 ||
    recordsPerPull > 64
  )
    throw new Error("Invalid streamed JSON array property or batch size");
  const object = JSON.stringify(metadata, null, 2);
  if (
    typeof object !== "string" ||
    !object.startsWith("{") ||
    !object.endsWith("}")
  )
    throw new Error("Invalid streamed JSON export metadata");
  const open = object === "{}" ? object.slice(0, -1) : object.slice(0, -2);
  const prefix = `${open}${object === "{}" ? "\n" : ",\n"}  ${JSON.stringify(key)}: [\n`;
  const encoder = new TextEncoder();
  const iterator = records[Symbol.iterator]();
  let headerPending = true,
    exhausted = false,
    index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (headerPending) {
        headerPending = false;
        controller.enqueue(encoder.encode(prefix));
        return;
      }
      if (!exhausted) {
        const parts: string[] = [];
        for (let count = 0; count < recordsPerPull; count++) {
          const next = iterator.next();
          if (next.done) {
            exhausted = true;
            break;
          }
          const row = JSON.stringify(next.value, null, 2);
          if (typeof row !== "string") {
            controller.error(new Error("Invalid streamed JSON export row"));
            return;
          }
          parts.push(
            `${index === 0 ? "" : ",\n"}    ${row.replace(/\n/g, "\n    ")}`,
          );
          index++;
        }
        if (parts.length) {
          controller.enqueue(encoder.encode(parts.join("")));
          return;
        }
      }
      controller.enqueue(encoder.encode("\n  ]\n}\n"));
      controller.close();
    },
    cancel() {
      iterator.return?.(undefined);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/json" },
  })
    .blob()
    .then((blob) => saveExport(blob, filename));
}
