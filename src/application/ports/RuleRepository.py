from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from src.domain.Rule import Rule


class RuleRepository(ABC):
    @abstractmethod
    async def find_processed_result(
        self, idempotency_key: str
    ) -> Optional[List[Dict[str, Any]]]:
        pass

    @abstractmethod
    async def save_all_new(
        self, rules: List[Rule], idempotency_key: Optional[str] = None
    ) -> List[Rule]:
        pass

    @abstractmethod
    async def update_status(
        self, ids: List[int], active: bool, idempotency_key: Optional[str] = None
    ) -> List[Rule]:
        pass

    @abstractmethod
    async def delete(
        self, ids: List[int], idempotency_key: Optional[str] = None
    ) -> List[Rule]:
        pass

    @abstractmethod
    async def get_all(self) -> List[Rule]:
        pass

    @abstractmethod
    async def find_by_ids(self, ids: List[int]) -> List[Rule]:
        pass

    @abstractmethod
    async def find_by_type_and_values(
        self, rule_type: str, values: List[str]
    ) -> List[Rule]:
        pass