from dataclasses import dataclass
from typing import Any, Dict

@dataclass
class ApplicationError:

    code: str
    message: str

    def to_dict(self) -> Dict[str, Any]:

        return {
            "status": "error",
            "code": self.code,
            "message": self.message
        }

@dataclass
class DomainError(ApplicationError):
    pass