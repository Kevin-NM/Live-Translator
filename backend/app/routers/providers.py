import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app import crud, schemas, translator

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/providers", tags=["providers"])


@router.get("", response_model=List[schemas.ProviderConfigRead])
async def list_providers(db: DbSession = Depends(get_db)):
    return crud.get_providers(db)


@router.post("", response_model=schemas.ProviderConfigRead, status_code=201)
async def create_provider(data: schemas.ProviderConfigCreate, db: DbSession = Depends(get_db)):
    return crud.create_provider(db, data)


@router.patch("/{provider_id}", response_model=schemas.ProviderConfigRead)
async def update_provider(provider_id: int, data: schemas.ProviderConfigUpdate, db: DbSession = Depends(get_db)):
    provider = crud.update_provider(db, provider_id, data)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    return provider


@router.delete("/{provider_id}", status_code=204)
async def delete_provider(provider_id: int, db: DbSession = Depends(get_db)):
    if not crud.delete_provider(db, provider_id):
        raise HTTPException(status_code=404, detail="Provider not found")


@router.post("/{provider_id}/test", response_model=List[schemas.ProviderTestResponse])
async def test_provider(provider_id: int, db: DbSession = Depends(get_db)):
    provider = crud.get_provider(db, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    if not provider.enabled:
        raise HTTPException(status_code=400, detail="Provider is disabled")

    results = await translator.test_provider(provider)
    return [
        schemas.ProviderTestResponse(
            status=r.status,
            latency_ms=round(r.latency_ms, 2),
            model=r.model,
            output=r.translated_text,
            error_message=r.error_message,
        )
        for r in results
    ]
