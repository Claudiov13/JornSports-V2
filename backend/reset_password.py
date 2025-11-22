import asyncio
import sys
from sqlalchemy import select
from database import engine
from models import User
from core.security import get_password_hash

async def reset_password(email: str, new_password: str):
    print(f"Procurando usuário: {email}")
    async with engine.begin() as conn:
        # We need a session for ORM usage, or we can use direct update
        # Let's use the session approach if possible, or direct execute
        # Since we have async engine, let's use a session maker or just direct update via connection if simple
        # But models.User is ORM. Let's use the session pattern from main.py/deps if available, 
        # or just construct a session.
        
        from sqlalchemy.ext.asyncio import AsyncSession
        from sqlalchemy.orm import sessionmaker
        
        AsyncSessionLocal = sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )
        
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(User).where(User.email == email))
            user = result.scalars().first()
            
            if not user:
                print(f"❌ Usuário não encontrado: {email}")
                return
            
            print(f"Usuário encontrado: {user.id}")
            new_hash = get_password_hash(new_password)
            user.password_hash = new_hash
            session.add(user)
            await session.commit()
            print(f"✅ Senha atualizada com sucesso para: {new_password}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        # Default behavior for the specific user request
        target_email = "claudiovargas77@gmail.com"
        new_pass = "12345678"
    else:
        target_email = sys.argv[1]
        new_pass = sys.argv[2] if len(sys.argv) > 2 else "12345678"
        
    asyncio.run(reset_password(target_email, new_pass))
