import base64
from tangent_sidecar.ingest import pdf_info


def test_pdf_info_preview_is_optional(tmp_path):
    import pypdfium2
    pdf = pypdfium2.PdfDocument.new()
    pdf.new_page(100, 200)
    path = tmp_path / 'book.pdf'
    pdf.save(str(path))
    pdf.close()
    assert pdf_info({'path': str(path)}) == {'pages': 1}
    preview = pdf_info({'path': str(path), 'preview': True})
    assert preview['pages'] == 1
    assert base64.b64decode(preview['thumbnailUrl'].split(',')[1]).startswith(b'\x89PNG')


def _text_pdf(path, text):
    # Minimal one-page PDF with a Helvetica text layer (pdfium rebuilds the missing xref).
    stream = f"BT /F1 12 Tf 20 100 Td ({text}) Tj ET".encode()
    path.write_bytes(b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
        + b"4 0 obj<</Length %d>>stream\n" % len(stream) + stream + b"\nendstream endobj\n"
        b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")


def test_scan_flags_pdfs_without_a_text_layer(tmp_path):
    import pypdfium2
    blank = pypdfium2.PdfDocument.new()
    blank.new_page(100, 200)
    scan = tmp_path / 'scan.pdf'
    blank.save(str(scan))
    blank.close()
    typed = tmp_path / 'typed.pdf'
    _text_pdf(typed, 'A sampling distribution is the distribution of a statistic.')
    assert pdf_info({'path': str(scan), 'scan': True})['scanned'] is True
    assert pdf_info({'path': str(typed), 'scan': True})['scanned'] is False
    assert 'scanned' not in pdf_info({'path': str(typed)})
