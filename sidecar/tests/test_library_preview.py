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
