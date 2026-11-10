import base64
from tangent_sidecar.ingest import original_pdf, pdf_info
import pytest


def test_original_pdf_roundtrip_and_validation(tmp_path):
    path = tmp_path / 'book.pdf'
    path.write_bytes(b'%PDF-1.7\nfixture')
    assert base64.b64decode(original_pdf({'path': str(path)})) == path.read_bytes()
    path.write_text('not a PDF')
    with pytest.raises(ValueError, match='contain a PDF'):
        original_pdf({'path': str(path)})
    with pytest.raises(ValueError):
        original_pdf({'path': 123})


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
