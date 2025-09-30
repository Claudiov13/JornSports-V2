# manage_db.py
import argparse
import asyncio
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.exc import SQLAlchemyError

from database import engine            # usa seu engine assíncrono
from models import Base                # usa seus modelos declarativos

async def ping_db(engine: AsyncEngine) -> None:
    try:
        async with engine.connect() as conn:
            await conn.execute(Base.metadata.bind.dialect._execute_on_connection if hasattr(Base.metadata.bind, "_execute_on_connection") else conn.exec_driver_sql, "SELECT 1")
        print("✅ Conexão OK (SELECT 1).")
    except Exception as e:
        print(f"❌ Falha ao conectar: {e}")
        raise

async def init_db(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        print("📦 Criando tabelas...")
        await conn.run_sync(Base.metadata.create_all)
    print("✅ Tabelas criadas.")

async def drop_db(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        print("🧹 Apagando tabelas...")
        await conn.run_sync(Base.metadata.drop_all)
    print("✅ Tabelas apagadas.")

async def reset_db(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        print("🔄 Resetando (drop & create)...")
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    print("✅ Reset concluído.")

async def main():
    parser = argparse.ArgumentParser(
        description="Gestão do banco (init/drop/reset/ping) para o Jorn Sports."
    )
    parser.add_argument(
        "cmd",
        choices=["init", "drop", "reset", "ping"],
        help="Ação a executar no banco."
    )
    parser.add_argument(
        "--yes", "-y",
        action="store_true",
        help="Confirma operações destrutivas sem perguntar."
    )
    args = parser.parse_args()

    try:
        if args.cmd == "ping":
            await ping_db(engine)
        elif args.cmd == "init":
            await init_db(engine)
        elif args.cmd == "drop":
            if not args.yes:
                resp = input("⚠️ Isso vai APAGAR todas as tabelas. Continuar? [digite YES]: ")
                if resp.strip() != "YES":
                    print("Operação cancelada.")
                    return
            await drop_db(engine)
        elif args.cmd == "reset":
            if not args.yes:
                resp = input("⚠️ Isso vai RESETAR (drop & create) todas as tabelas. Continuar? [digite YES]: ")
                if resp.strip() != "YES":
                    print("Operação cancelada.")
                    return
            await reset_db(engine)
    except SQLAlchemyError as e:
        print(f"❌ Erro SQLAlchemy: {e}")
        raise
    except Exception as e:
        print(f"❌ Erro: {e}")
        raise

if __name__ == "__main__":
    asyncio.run(main())
