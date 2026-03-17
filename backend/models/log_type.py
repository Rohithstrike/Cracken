from pydantic import BaseModel


class LogTypeResponse(BaseModel):
    """
    Describes one available log pattern for the frontend dropdown.

    Fields match exactly what the frontend needs to:
    - Display the pattern in a dropdown (pattern_name)
    - Group patterns by category (log_type)
    - Show the user what columns will be extracted (columns)
    - Pass the selected pattern back to /api/upload (pattern_id)
    """
    pattern_id:   str
    pattern_name: str
    log_type:     str
    columns:      list[str]