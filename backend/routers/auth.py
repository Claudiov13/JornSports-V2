from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

import models
from core.deps import get_db, get_current_user, get_user_by_email
from core.security import get_password_hash, verify_password, create_access_token
from core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int

@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register_coach(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    email = payload.email.lower()
    existing_user = await get_user_by_email(db, email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )
    user = models.User(email=email, password_hash=get_password_hash(payload.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {
        "id": str(user.id),
        "email": user.email,
        "role": user.role,
        "created_at": user.created_at,
    }

@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    # Authenticate user logic inline or helper
    user = await get_user_by_email(db, payload.email.lower())
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    expires_delta = timedelta(hours=settings.ACCESS_TOKEN_EXPIRE_HOURS)
    token = create_access_token({"sub": user.email, "role": user.role}, expires_delta)
    return TokenResponse(access_token=token, expires_in=int(expires_delta.total_seconds()))

@router.get("/me") # Changed from /api/me to /auth/me or keep /api/me? The plan said /auth/me implicitly by grouping. I'll add a separate router for /api if needed, but /auth/me is standard. Wait, the original was /api/me. I will keep it here but maybe alias or move to a user router. I'll keep it in auth for now but path /me relative to /auth -> /auth/me.
async def read_me(current_user: models.User = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "role": current_user.role,
        "created_at": current_user.created_at,
    }
