"""Offline, dependency-free OOXML inventory. Never executes workbook formulas."""
import hashlib
import io
import json
import pathlib
import re
import zipfile
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "generated-artifacts/source-search"
S = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
W = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

def sha(b):
    return hashlib.sha256(b).hexdigest()

def paragraphs(b):
    with zipfile.ZipFile(io.BytesIO(b)) as z:
        tree = ET.fromstring(z.read("word/document.xml"))
        return ["".join(t.text or "" for t in p.findall(".//w:t", W))
                for p in tree.findall(".//w:body/w:p", W)]

def workbook(b):
    with zipfile.ZipFile(io.BytesIO(b)) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            shared = ["".join(e.itertext()) for e in ET.fromstring(z.read("xl/sharedStrings.xml"))]
        rels = {r.attrib["Id"]: r.attrib["Target"] for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
        sheets = {}
        for s in ET.fromstring(z.read("xl/workbook.xml")).findall("s:sheets/s:sheet", S):
            target = rels[s.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]]
            path = target.lstrip("/") if target.startswith("/") else "xl/" + target
            rows = []
            for row in ET.fromstring(z.read(path)).findall("s:sheetData/s:row", S):
                cells = {}
                for c in row.findall("s:c", S):
                    v = c.find("s:v", S)
                    value = v.text if v is not None else ""
                    if c.attrib.get("t") == "s":
                        value = shared[int(value)] if value else ""
                    elif c.attrib.get("t") == "inlineStr":
                        value = "".join(t.text or "" for t in c.findall(".//s:t", S))
                    cells[re.sub(r"\d", "", c.attrib["r"])] = value or ""
                if any(cells.values()):
                    rows.append({"row": int(row.attrib["r"]), "cells": cells})
            headers = rows[0]["cells"] if rows else {}
            sheets[s.attrib["name"]] = {"headers": headers, "rows": [
                {"row": r["row"], "data": {headers.get(k, "UNHEADED_" + k): v for k, v in r["cells"].items()}}
                for r in rows[1:]]}
        return sheets

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    package = ROOT / "attached_assets/Source_Search_Lean_Updated_Package_2026-08-31_1793987596108.zip"
    manifest, documents, sheets = [], {}, {}
    with zipfile.ZipFile(package) as z:
        names = [n for n in z.namelist() if not n.endswith("/")]
        expected = z.read(next(n for n in names if n.endswith("99_SHA256_MANIFEST.txt"))).decode()
        for n in names:
            b = z.read(n)
            digest = sha(b)
            base = pathlib.PurePosixPath(n).name
            match = next((line for line in expected.splitlines() if base in line), None)
            if not base.startswith("99_"):
                assert match and digest in match, "Package checksum mismatch: " + base
            manifest.append({"file": n, "hash": digest, "bytes": len(b), "checksum": "verified" if match else "manifest-self"})
            if n.endswith(".xlsx"):
                sheets = workbook(b)
            if n.endswith(".docx"):
                documents[base] = paragraphs(b)
        for p in sorted((ROOT / "attached_assets").glob("*Coverage_Full_Article_Text_Archive_*.docx")):
            b = p.read_bytes()
            documents[p.name] = paragraphs(b)
            manifest.append({"file": str(p.relative_to(ROOT)), "hash": sha(b), "bytes": len(b), "checksum": "local-input"})
    result = {"manifest": manifest, "sheets": sheets, "documents": documents, "packageHash": sha(package.read_bytes())}
    (OUT / "inventory.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    for name, ps in documents.items():
        (OUT / (name + ".txt")).write_text("\n".join(f"{i}: {p}" for i, p in enumerate(ps)))
    print(json.dumps({"manifest": manifest, "sheets": {n: {"rows": len(s["rows"]), "headers": s["headers"],
          "sample": s["rows"][:1]} for n, s in sheets.items()}}, indent=2))

if __name__ == "__main__":
    main()
