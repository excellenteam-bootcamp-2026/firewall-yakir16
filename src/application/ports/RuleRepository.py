from abc import ABC, abstractmethod
from typing import List, Optional

from src.domain.Rule import Rule


class RuleRepository(ABC):

    @abstractmethod
    async def save(self, rule: Rule) -> None:
        pass

    @abstractmethod
    async def save_all(self, rules: List[Rule]) -> None:
        pass

    @abstractmethod
    async def delete(self, ids: List[int]) -> None:
        pass

    @abstractmethod
    async def get_all(self) -> List[Rule]:
        pass

    @abstractmethod
    async def find_by_ids(self, ids: List[int]) -> List[Rule]:
        pass

    @abstractmethod
    async def check_exists(self, rule_type: str, value: str) -> bool:
        pass

    @abstractmethod
    async def find_by_type_and_value(self, rule_type: str, value: str) -> Optional[Rule]:
        pass