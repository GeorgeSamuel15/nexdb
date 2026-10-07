import { RecordDecoder } from "../../storage/src/records.ts";
import { SlottedPage, PAGE_SIZE } from "../../storage/src/index.ts";
import { assert } from "../../common/src/index.ts";
/** Validate every page before recovery overwrites a database file. */
export function validateImage(image: Buffer) {
  assert(
    image.length > 0 && image.length % PAGE_SIZE === 0,
    "CORRUPT",
    "Snapshot length",
  );
  const decoder = new RecordDecoder();
  for (let at = 0; at < image.length; at += PAGE_SIZE) {
    const page = new SlottedPage(image.subarray(at, at + PAGE_SIZE));
    page.validate(at / PAGE_SIZE);
    decoder.push(page);
  }
  decoder.finish();
}
