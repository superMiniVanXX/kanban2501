from pydantic import BaseModel


class DailyStats(BaseModel):
    date: str
    completed_count: int
    progress_delta: int


class WeeklyStats(BaseModel):
    week: str
    completed_count: int
    progress_delta: int


class MonthlyStats(BaseModel):
    month: str
    completed_count: int
    progress_delta: int


class StatisticsResponse(BaseModel):
    daily: list[DailyStats]
    weekly: list[WeeklyStats]
    monthly: list[MonthlyStats]
