"""Check that figures in a model answer can be traced to this turn's evidence.

Every decimal number, percentage and larger integer in the answer must match (after rounding to
the precision written) a number in a tool result, the validated context, the user's question or
the fixed method constants. Unmatched figures are reported to the UI rather than silently shown
as fact.
"""

import math
import re
from typing import Any, Iterable

from .. import config

# Constants stated in the system prompt and the official method.
METHOD_CONSTANTS = [
    *config.SCORING_WEIGHTS.values(), *(weight * 100 for weight in config.SCORING_WEIGHTS.values()),
    30, 50, 70, 100, 60, 0.6, 0.4, 0.10, 0.05, 0.01, 24, 168, 447, 50, 10, 2014, 2018, 2025,
    config.PM25_FULL_SCALE, config.PM10_FULL_SCALE, config.DEFAULT_AQI_STRESS_SCORE,
]
SMALL_INTEGER_LIMIT = 12

STRIP_PATTERNS = [
    re.compile(r"\bC_\d+,\d+\b"),                                     # cell IDs
    re.compile(r"\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?"),  # dates and timestamps
    re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b"),                      # clock times
    re.compile(r"\bPM\s?(?:2\.5|10)\b", re.I),                       # pollutant names
    re.compile(r"\b(?:Sentinel|Landsat)[- ]?\d+\b", re.I),             # sensor names
    re.compile(r"\b[A-Za-z]+\d+[A-Za-z\d]*\b"),                        # IDs such as Z01
]
NUMBER = re.compile(r"(?<![\w.])([-−+]?)(\d+(?:\.\d+)?)(?![\w.]\d)")


def _flatten(value: Any, out: list[float]) -> None:
    if isinstance(value, bool) or value is None:
        return
    if isinstance(value, (int, float)):
        if math.isfinite(value):
            out.append(float(value))
    elif isinstance(value, dict):
        for item in value.values():
            _flatten(item, out)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _flatten(item, out)
    elif isinstance(value, str):
        for match in NUMBER.finditer(value):
            out.append(float(match.group(2)))


def extract_figures(text: str) -> list[str]:
    cleaned = text
    for pattern in STRIP_PATTERNS:
        cleaned = pattern.sub(" ", cleaned)
    figures = []
    for match in NUMBER.finditer(cleaned):
        literal = match.group(2)
        if "." not in literal and float(literal) <= SMALL_INTEGER_LIMIT:
            continue  # list numbering, small counts, "two zones"
        figures.append(literal)
    return figures


def _matches(literal: str, allowed: Iterable[float]) -> bool:
    decimals = len(literal.split(".")[1]) if "." in literal else 0
    target = float(literal)
    tolerance = 0.5 * 10 ** (-decimals) + 1e-9
    for value in allowed:
        for candidate in (value, abs(value), value * 100, abs(value) * 100):
            if abs(round(candidate, decimals) - target) <= tolerance or abs(candidate - target) <= tolerance:
                return True
            if decimals == 0 and int(abs(candidate)) == target:
                return True
    return False


def verify_figures(answer: str, sources: Iterable[Any], extra_numbers: Iterable[float] = ()) -> dict[str, Any]:
    allowed: list[float] = [float(value) for value in METHOD_CONSTANTS]
    allowed.extend(float(value) for value in extra_numbers)
    for source in sources:
        _flatten(source, allowed)
    figures = extract_figures(answer)
    unverified = [figure for figure in figures if not _matches(figure, allowed)]
    unique = list(dict.fromkeys(unverified))[:8]
    if not figures:
        status = "no_figures"
    elif unique:
        status = "unverified_figures"
    else:
        status = "verified"
    return {"status": status, "checked": len(figures), "unverified": unique}
