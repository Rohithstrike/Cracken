from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ── Settings ─────────────────────────────────────────────────────────────
from backend.config import settings
from backend.utils.logger import configure_logging, get_logger

# ── Configure logging BEFORE app creation ────────────────────────────────
configure_logging()
logger = get_logger(__name__)

# ── FastAPI App ─────────────────────────────────────────────────────────
app = FastAPI(
    title="SOC Log Parser",
    description=(
        "Blue Team log parsing tool. "
        "Converts raw security logs into structured, analyzable data."
    ),
    version="1.0.0",
    docs_url="/docs" if settings.is_development else None,
    redoc_url="/redoc" if settings.is_development else None,
)

# ── Middleware ──────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.is_development else [],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Routers ─────────────────────────────────────────────────────────────
# Import AFTER settings to ensure .env variables (VT_API_KEY) are loaded
from backend.api.routes.upload    import router as upload_router
from backend.api.routes.export    import router as export_router
from backend.api.routes.log_types import router as log_types_router
from backend.api.routes.vt_check  import router as vt_router

# Include routers
app.include_router(upload_router)
app.include_router(export_router)
app.include_router(log_types_router)
app.include_router(vt_router, prefix="/api")  # ✅ VT router fixed

# ── Startup Event ───────────────────────────────────────────────────────
@app.on_event("startup")
async def on_startup() -> None:
    logger.info(
        "soc_log_parser_started",
        environment=settings.app_env,
        ai_provider=settings.ai_provider,
        max_file_size_mb=settings.max_file_size_mb,
    )

# ── Health Check ────────────────────────────────────────────────────────
@app.get("/health", tags=["system"])
async def health_check() -> dict:
    return {
        "status": "ok",
        "environment": settings.app_env,
        "ai_provider": settings.ai_provider,
        "max_file_size_mb": settings.max_file_size_mb,
        "allowed_extensions": settings.allowed_extensions_list,
    }