(function () {
  "use strict";

  const textEncoder = new TextEncoder();
  const crcTable = createCrcTable();

  function createCrcTable() {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }
      table[index] = value >>> 0;
    }
    return table;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function concatUint8Arrays(chunks) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    chunks.forEach((chunk) => {
      merged.set(chunk, offset);
      offset += chunk.length;
    });
    return merged;
  }

  function writeUint16(view, offset, value) {
    view.setUint16(offset, value & 0xffff, true);
  }

  function writeUint32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function toDosDateTime(dateInput) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
    const year = Math.max(date.getFullYear(), 1980);
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    return { dosDate, dosTime };
  }

  function stringToBytes(value) {
    return textEncoder.encode(value);
  }

  function createZip(files) {
    const localRecords = [];
    const centralRecords = [];
    let offset = 0;

    files.forEach((file) => {
      const fileNameBytes = stringToBytes(file.name);
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
      const checksum = crc32(data);
      const { dosDate, dosTime } = toDosDateTime(file.lastModified);

      const localHeader = new Uint8Array(30 + fileNameBytes.length);
      const localView = new DataView(localHeader.buffer);
      writeUint32(localView, 0, 0x04034b50);
      writeUint16(localView, 4, 20);
      writeUint16(localView, 6, 0);
      writeUint16(localView, 8, 0);
      writeUint16(localView, 10, dosTime);
      writeUint16(localView, 12, dosDate);
      writeUint32(localView, 14, checksum);
      writeUint32(localView, 18, data.length);
      writeUint32(localView, 22, data.length);
      writeUint16(localView, 26, fileNameBytes.length);
      writeUint16(localView, 28, 0);
      localHeader.set(fileNameBytes, 30);

      const centralHeader = new Uint8Array(46 + fileNameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      writeUint32(centralView, 0, 0x02014b50);
      writeUint16(centralView, 4, 20);
      writeUint16(centralView, 6, 20);
      writeUint16(centralView, 8, 0);
      writeUint16(centralView, 10, 0);
      writeUint16(centralView, 12, dosTime);
      writeUint16(centralView, 14, dosDate);
      writeUint32(centralView, 16, checksum);
      writeUint32(centralView, 20, data.length);
      writeUint32(centralView, 24, data.length);
      writeUint16(centralView, 28, fileNameBytes.length);
      writeUint16(centralView, 30, 0);
      writeUint16(centralView, 32, 0);
      writeUint16(centralView, 34, 0);
      writeUint16(centralView, 36, 0);
      writeUint32(centralView, 38, 0);
      writeUint32(centralView, 42, offset);
      centralHeader.set(fileNameBytes, 46);

      localRecords.push(localHeader, data);
      centralRecords.push(centralHeader);
      offset += localHeader.length + data.length;
    });

    const centralDirectory = concatUint8Arrays(centralRecords);
    const endRecord = new Uint8Array(22);
    const endView = new DataView(endRecord.buffer);
    writeUint32(endView, 0, 0x06054b50);
    writeUint16(endView, 4, 0);
    writeUint16(endView, 6, 0);
    writeUint16(endView, 8, files.length);
    writeUint16(endView, 10, files.length);
    writeUint32(endView, 12, centralDirectory.length);
    writeUint32(endView, 16, offset);
    writeUint16(endView, 20, 0);

    return concatUint8Arrays([...localRecords, centralDirectory, endRecord]);
  }

  function escapeXml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function createParagraphXml(text, options) {
    const safeText = escapeXml(text);
    const styleTag = options && options.style ? `<w:pStyle w:val="${escapeXml(options.style)}"/>` : "";
    const spacingTag = options && options.spacingAfter ? `<w:spacing w:after="${options.spacingAfter}"/>` : "";
    const props = styleTag || spacingTag ? `<w:pPr>${styleTag}${spacingTag}</w:pPr>` : "";
    return `<w:p>${props}<w:r><w:t xml:space="preserve">${safeText}</w:t></w:r></w:p>`;
  }

  function createCellXml(text, widthTwips, style) {
    const paragraph = createParagraphXml(text || "", style ? { style } : undefined);
    return `<w:tc><w:tcPr><w:tcW w:w="${widthTwips}" w:type="dxa"/></w:tcPr>${paragraph}</w:tc>`;
  }

  function createTableXml(rows) {
    const widthTimestamp = 1800;
    const widthSpeaker = 2300;
    const widthNotes = 5500;
    const headerRow = [
      createCellXml("Timestamp", widthTimestamp, "TableHeader"),
      createCellXml("Speaker", widthSpeaker, "TableHeader"),
      createCellXml("Notes", widthNotes, "TableHeader"),
    ].join("");

    const bodyRows = rows
      .map((row) => {
        return `<w:tr>${
          createCellXml(row.elapsedLabel || "", widthTimestamp) +
          createCellXml(row.speaker || "", widthSpeaker) +
          createCellXml(row.notes || "", widthNotes)
        }</w:tr>`;
      })
      .join("");

    return `
      <w:tbl>
        <w:tblPr>
          <w:tblStyle w:val="TableGrid"/>
          <w:tblW w:w="0" w:type="auto"/>
          <w:tblLook w:val="04A0"/>
        </w:tblPr>
        <w:tblGrid>
          <w:gridCol w:w="${widthTimestamp}"/>
          <w:gridCol w:w="${widthSpeaker}"/>
          <w:gridCol w:w="${widthNotes}"/>
        </w:tblGrid>
        <w:tr>${headerRow}</w:tr>
        ${bodyRows}
      </w:tbl>
    `;
  }

  function createAttendanceTableXml(attendance) {
    if (!attendance || attendance.length === 0) {
      return "";
    }

    const widthName = 6200;
    const widthStatus = 3400;
    const headerRow = [
      createCellXml("Member", widthName, "TableHeader"),
      createCellXml("Attendance", widthStatus, "TableHeader"),
    ].join("");

    const bodyRows = attendance
      .map((member) => {
        return `<w:tr>${
          createCellXml(member.displayName || member.name || "", widthName) +
          createCellXml(member.status === "present" ? "Present" : "Absent", widthStatus)
        }</w:tr>`;
      })
      .join("");

    return `
      <w:tbl>
        <w:tblPr>
          <w:tblStyle w:val="TableGrid"/>
          <w:tblW w:w="0" w:type="auto"/>
          <w:tblLook w:val="04A0"/>
        </w:tblPr>
        <w:tblGrid>
          <w:gridCol w:w="${widthName}"/>
          <w:gridCol w:w="${widthStatus}"/>
        </w:tblGrid>
        <w:tr>${headerRow}</w:tr>
        ${bodyRows}
      </w:tbl>
    `;
  }

  function createDocumentXml(exportData) {
    const attendanceXml = exportData.attendance && exportData.attendance.length > 0
      ? [
        createParagraphXml("Attendance", { style: "Heading1", spacingAfter: 140 }),
        createAttendanceTableXml(exportData.attendance),
        createParagraphXml("", { spacingAfter: 180 }),
      ].join("")
      : "";
    const sectionXml = exportData.sections
      .map((section, sectionIndex) => {
        const paragraphs = [];
        paragraphs.push(createParagraphXml(section.title || `Agenda Item ${sectionIndex + 1}`, { style: "Heading1", spacingAfter: 140 }));
        paragraphs.push(createTableXml(section.rows));
        paragraphs.push(createParagraphXml("", { spacingAfter: 180 }));
        return paragraphs.join("");
      })
      .join("");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document
        xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
        xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
        xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
        xmlns:v="urn:schemas-microsoft-com:vml"
        xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
        xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
        xmlns:w10="urn:schemas-microsoft-com:office:word"
        xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
        xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
        xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
        xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
        xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
        xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
        mc:Ignorable="w14 w15 wp14">
        <w:body>
          ${createParagraphXml(exportData.title || "Meeting Minutes", { style: "Title", spacingAfter: 220 })}
          ${createParagraphXml(`Session started: ${exportData.startedAtLabel}`, { spacingAfter: 80 })}
          ${createParagraphXml(`Exported: ${exportData.exportedAtLabel}`, { spacingAfter: 180 })}
          ${attendanceXml}
          ${sectionXml}
          <w:sectPr>
            <w:pgSz w:w="12240" w:h="15840"/>
            <w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/>
          </w:sectPr>
        </w:body>
      </w:document>`;
  }

  function createStylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
          <w:name w:val="Normal"/>
          <w:qFormat/>
          <w:rPr>
            <w:sz w:val="22"/>
            <w:szCs w:val="22"/>
          </w:rPr>
        </w:style>
        <w:style w:type="paragraph" w:styleId="Title">
          <w:name w:val="Title"/>
          <w:basedOn w:val="Normal"/>
          <w:qFormat/>
          <w:rPr>
            <w:b/>
            <w:sz w:val="32"/>
            <w:szCs w:val="32"/>
          </w:rPr>
        </w:style>
        <w:style w:type="paragraph" w:styleId="Heading1">
          <w:name w:val="Heading 1"/>
          <w:basedOn w:val="Normal"/>
          <w:qFormat/>
          <w:rPr>
            <w:b/>
            <w:sz w:val="28"/>
            <w:szCs w:val="28"/>
          </w:rPr>
        </w:style>
        <w:style w:type="paragraph" w:styleId="TableHeader">
          <w:name w:val="Table Header"/>
          <w:basedOn w:val="Normal"/>
          <w:rPr>
            <w:b/>
          </w:rPr>
        </w:style>
      </w:styles>`;
  }

  function createContentTypesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
        <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
        <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
        <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
      </Types>`;
  }

  function createPackageRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
        <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
      </Relationships>`;
  }

  function createDocumentRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
      </Relationships>`;
  }

  function createAppXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
        xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
        <Application>Shorthand</Application>
      </Properties>`;
  }

  function createCoreXml(exportData) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:dcterms="http://purl.org/dc/terms/"
        xmlns:dcmitype="http://purl.org/dc/dcmitype/"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <dc:title>${escapeXml(exportData.title || "Meeting Minutes")}</dc:title>
        <dc:creator>Shorthand</dc:creator>
        <cp:lastModifiedBy>Shorthand</cp:lastModifiedBy>
        <dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(exportData.exportedAtIso)}</dcterms:created>
        <dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXml(exportData.exportedAtIso)}</dcterms:modified>
      </cp:coreProperties>`;
  }

  async function createDocxBlob(exportData) {
    const files = [
      { name: "[Content_Types].xml", data: stringToBytes(createContentTypesXml()) },
      { name: "_rels/.rels", data: stringToBytes(createPackageRelsXml()) },
      { name: "docProps/app.xml", data: stringToBytes(createAppXml()) },
      { name: "docProps/core.xml", data: stringToBytes(createCoreXml(exportData)) },
      { name: "word/document.xml", data: stringToBytes(createDocumentXml(exportData)) },
      { name: "word/styles.xml", data: stringToBytes(createStylesXml()) },
      { name: "word/_rels/document.xml.rels", data: stringToBytes(createDocumentRelsXml()) },
    ];
    return new Blob([createZip(files)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  window.MinuteStakerExport = {
    createDocxBlob,
    createZip,
    downloadBlob,
    stringToBytes,
  };
}());
