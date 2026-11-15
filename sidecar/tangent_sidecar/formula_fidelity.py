"""Conservative text-layer checks; geometric matches alone cannot ground a formula."""
import re
import unicodedata
from collections import Counter


SYMBOLS = {
    "frac": "/", "dfrac": "/", "tfrac": "/", "infty": "∞",
    "sigma": "σ", "mu": "μ", "Phi": "Φ", "alpha": "α", "beta": "β",
    "theta": "θ", "pi": "π", "sum": "∑", "sqrt": "√", "pm": "±",
    "le": "≤", "leq": "≤", "ge": "≥", "geq": "≥", "neq": "≠",
    "approx": "≈", "sim": "∼", "cdot": "·", "times": "×",
    "bar": "\u0304", "overline": "\u0304", "hat": "\u0302",
    "checkmark": "✓", "bullet": "•", "Rightarrow": "⇒", "Longrightarrow": "⇒",
}
LAYOUT = {"left", "right", "text", "mathrm", "mathbf",
          "mathit", "quad", "qquad", "colon", "begin", "end"}


def repair_digits(text):
    text = text.replace("−", "-")
    text = re.sub(r"(?<=\d)\s+(?=\d)", "", text)
    return re.sub(r"(?<=\d)\s*\.\s*(?=\d)", ".", text)


def numbers(text):
    return Counter(re.findall(r"[+-]?\s*(?:\d+(?:\.\d+)?|\.\d+)", repair_digits(text).replace(" ", "")))


def malformed(text):
    depth = 0
    for brace in re.findall(r"(?<!\\)[{}]", text):
        depth += 1 if brace == "{" else -1
        if depth < 0:
            return True
    return bool(depth or re.search(r"\\sqrt\s*\{[\s\\,;!]*\}|\\\s*$", text)
                or ("&" in text and not re.search(r"\\begin\s*\{(?:aligned|align|array)", text)))


def symbols(text):
    # Ignore prose wrappers, retain their letters (including named subscripts such as new/old).
    text = re.sub(r"\\([A-Za-z]+)", lambda m: SYMBOLS.get(m[1], "" if m[1] in LAYOUT else m[0]), text)
    text = unicodedata.normalize("NFD", text).replace("\u0305", "\u0304").replace("−", "-")
    supers = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ"
    subs = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎"
    text = re.sub(f"[{supers}]+", "^", text)
    text = re.sub(f"[{subs}]+", "_", text)
    return Counter(c for c in text if c.isalpha() or unicodedata.category(c) in {"Sm", "So"} or c in "_^\u0304\u0302σμΦ∑√±≤≥≠≈∼·×✓•⇒<>+=-/%!|")


def scripts(text):
    groups = re.findall(r"([_^])\s*(\{(?:[^{}]|\{[^{}]*\})*\}|\\[A-Za-z]+|[^\s{}])", text)
    return Counter((marker, re.sub(r"[{}\s]", "", body)) for marker, body in groups)


def check_formula(decoded, orig):
    """Return replacement, fidelity and disagreement reasons without retaining unsafe numbers."""
    decoded, orig = decoded.strip(), orig.strip()
    reasons = []
    if not decoded:
        reasons.append("missing decode")
    if numbers(decoded) != numbers(orig):
        reasons.append("numbers")
    if symbols(orig) - symbols(decoded) or scripts(orig) - scripts(decoded):
        reasons.append("symbols")
    if malformed(decoded):
        reasons.append("malformed LaTeX")
    usable = bool(orig and any(c.isalnum() or c in "✓√∑" for c in orig)
                  and not any(unicodedata.category(c) in {"Cc", "Co", "Cs", "Cn"} and not c.isspace() for c in orig)
                  and not re.search(r"�|\(cid:\d+\)", orig) and not malformed(orig))
    if not usable:
        reasons.append("unusable text layer")
    # shortcut: token checks cannot prove equivalence or repair a corrupt source; use visual review for that.
    if not reasons:
        return f"$${repair_digits(decoded)}$$", "verified", []
    if usable:
        return repair_digits(orig), "fallback", reasons
    # Removing the expression from every source surface also excludes its numbers from the numeric gate.
    return "[Formula unverified; consult the source. Omit its numerical claims.]", "unverified", reasons
