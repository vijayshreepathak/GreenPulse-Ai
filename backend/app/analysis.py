"""The official zone ranking for a given air-quality payload.

Shared by the REST endpoints and the AI Copilot tools so both always score zones the same way.
"""

from typing import Any

import pandas as pd

from .data_loader import load_required_dataset
from .external_apis import pm_stress_for_scoring
from .scoring import score_zones


def official_priority_table(environment: dict[str, Any] | None) -> tuple[pd.DataFrame, list[str]]:
    """Score zones with the PM stress of ``environment`` (the documented fallback when it has none)."""
    stress, source = pm_stress_for_scoring(environment)
    return score_zones(
        load_required_dataset("zone_ndvi"),
        load_required_dataset("land_cover"),
        load_required_dataset("historical_ndvi"),
        stress,
        pm_stress_source=source,
    )
