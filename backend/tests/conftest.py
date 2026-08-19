# backend/tests/conftest.py
import pytest
import tempfile
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

# Import models FIRST to register them with Base.metadata
from app.models import Project  # noqa: F401
from app.models.remote_host import RemoteHost  # noqa: F401
from app.database import Base, get_db
from app import database

# Create a temporary file for the test database
fd, path = tempfile.mkstemp(suffix=".db")
os.close(fd)

TEST_DB_URL = f"sqlite:///{path}"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Override the production database with test database
database.engine = engine
database.SessionLocal = TestSessionLocal

# Now import the app (it will use the overridden database)
from app.main import app


def override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    # Clean up the test database file
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_session():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()
