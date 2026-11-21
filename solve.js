// A fast drop-in for csv-reader 1.0.0.
//
// The text is read once, left to right, and the answer is exactly what
// csv-reader returns for the same input: {columns, rows, errors}. The
// broken-row policy it reproduces, field for field:
//
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not
//     doubled, "" inside it is one quote, and each CRLF or lone CR inside
//     it reads as LF; what follows the closing quote, up to the next comma
//     or line break, is appended as it stands (quote_junk, when the field
//     ends); a quote that never closes is a literal character and the text
//     after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows are
//     the rest, each padded (short_row, with fields: its field count) or cut
//     (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met; line is the 1-based
//     line its record starts on, counting every LF, CRLF and lone CR inside
//     quotes; row is its record's index in rows, null for the header.
//
// Speed comes from never walking the text a character at a time in
// JavaScript. A whole clean line (no quote, no carriage return except a
// trailing CRLF) is split by the native split in one go. Every other field
// is found with indexOf scans that stop at the first delimiter, and the
// carriage returns are located once up front, in one native sweep, so no
// scan ever runs past the end of the field it is looking in. Nothing is
// kept from one call to the next; no clock, no randomness, no network.

// How a field ended.
const END = 0;
const COMMA = 1;
const BREAK = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // Where every carriage return sits, gathered in one native sweep. The
  // field scanner asks for the next one in O(1) through the pointer below
  // instead of rescanning the rest of the text for each field, which would
  // run far past a field's end whenever CRs are sparse.
  const crs = [];
  for (let i = text.indexOf('\r'); i !== -1; i = text.indexOf('\r', i + 1)) {
    crs.push(i);
  }
  let cri = 0;
  const nextCr = () => {
    while (cri < crs.length && crs[cri] < pos) cri++;
    return cri < crs.length ? crs[cri] : -1;
  };

  // The record being read: the line it starts on and the index in rows it
  // takes (null for the header). Every error of the record carries these.
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended, and how many characters its unquoted
  // scan kept. The field readers write these instead of allocating a
  // result per field; calls are strictly sequential, so one pair is enough.
  let fEnded = END;
  let fAdded = 0;

  // Reads an unquoted field starting at pos, appending what it keeps onto
  // `value`. Returns the field; fEnded says how it ended, fAdded how many
  // characters were kept. A CR not followed by LF is dropped and records
  // stray_cr; the field goes on.
  function readPlain(value) {
    let added = 0;
    for (;;) {
      const comma = text.indexOf(',', pos);
      const lf = text.indexOf('\n', pos);
      const cr = nextCr();
      let end = -1;
      let kind = END;
      if (comma !== -1 && (end === -1 || comma < end)) {
        end = comma;
        kind = COMMA;
      }
      if (lf !== -1 && (end === -1 || lf < end)) {
        end = lf;
        kind = BREAK;
      }
      if (cr !== -1 && (end === -1 || cr < end)) {
        end = cr;
        kind = 3;
      }
      if (end === -1) {
        if (pos < len) {
          added += len - pos;
          value += text.slice(pos);
          pos = len;
        }
        fEnded = END;
        fAdded = added;
        return value;
      }
      if (end > pos) {
        added += end - pos;
        value += text.slice(pos, end);
      }
      if (kind === COMMA) {
        pos = end + 1;
        fEnded = COMMA;
        fAdded = added;
        return value;
      }
      if (kind === BREAK) {
        pos = end + 1;
        line += 1;
        fEnded = BREAK;
        fAdded = added;
        return value;
      }
      // A carriage return: CRLF ends the record, a lone one is dropped.
      if (text.charCodeAt(end + 1) === 10) {
        pos = end + 2;
        line += 1;
        fEnded = BREAK;
        fAdded = added;
        return value;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = end + 1;
    }
  }

  // Appends text[from..to) to value, turning each CRLF or lone CR into one
  // LF and counting every line break it holds. The stretch holds no quote:
  // it ends at a closing or doubled quote.
  function appendQuoted(value, from, to) {
    const seg = text.slice(from, to);
    if (seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) {
      return value + seg;
    }
    let out = value;
    let i = 0;
    for (;;) {
      const r = seg.indexOf('\r', i);
      const n = seg.indexOf('\n', i);
      let b = -1;
      let isCr = false;
      if (r !== -1 && (n === -1 || r < n)) {
        b = r;
        isCr = true;
      } else if (n !== -1) {
        b = n;
      }
      if (b === -1) {
        if (i < seg.length) out += seg.slice(i);
        return out;
      }
      if (b > i) out += seg.slice(i, b);
      out += '\n';
      line += 1;
      i = isCr && seg.charCodeAt(b + 1) === 10 ? b + 2 : b + 1;
    }
  }

  // Reads a quoted field; pos is at its opening quote. Returns the field;
  // fEnded says how it ended.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let scan = pos + 1;
    for (;;) {
      const q = text.indexOf('"', scan);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as an unquoted field.
        pos = open + 1;
        line = openLine;
        errors.push({
          code: 'unterminated_quote',
          line: recordLine,
          row: recordRow,
        });
        return readPlain('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one literal quote; the field goes on.
        value = appendQuoted(value, scan, q) + '"';
        scan = q + 2;
        continue;
      }
      value = appendQuoted(value, scan, q);
      pos = q + 1;
      break;
    }
    if (pos >= len) {
      fEnded = END;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fEnded = COMMA;
      return value;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fEnded = BREAK;
      return value;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fEnded = BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readPlain(value);
    if (fAdded > 0) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a whole clean line. It holds no quote and no carriage
    // return except a trailing CRLF, so every field in it is unquoted and
    // ends at a comma or at the line break: split it in one native call.
    // Anything else goes through the field scanner below.
    let fields;
    let quoted = false;
    const lf = text.indexOf('\n', pos);
    const lineEnd = lf === -1 ? len : lf;
    let segEnd = lineEnd;
    if (lf !== -1 && lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13) {
      segEnd = lineEnd - 1;
    }
    const q = text.indexOf('"', pos);
    const cr = nextCr();
    if ((q === -1 || q >= segEnd) && (cr === -1 || cr >= segEnd)) {
      fields = text.slice(pos, segEnd).split(',');
      pos = lf === -1 ? len : lf + 1;
      if (lf !== -1) line += 1;
    } else {
      fields = [];
      let field;
      do {
        quoted = text.charCodeAt(pos) === 34;
        field = quoted ? readQuoted() : readPlain('');
        fields.push(field);
      } while (fEnded === COMMA);
    }

    // A line that held only stray CRs is left with no characters, and a
    // single empty unquoted field that is the whole record is also no
    // record (their stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({
        code: 'short_row',
        line: recordLine,
        row: recordRow,
        fields: fields.length,
      });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({
        code: 'long_row',
        line: recordLine,
        row: recordRow,
        extra: fields.splice(width),
      });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
