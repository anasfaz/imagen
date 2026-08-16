"""MongoDB setup shared across modules."""
import os
from motor.motor_asyncio import AsyncIOMotorClient

_mongo_url = os.environ["MONGO_URL"]
_db_name = os.environ["DB_NAME"]

client = AsyncIOMotorClient(_mongo_url)
db = client[_db_name]

# Collections
generations = db["generations"]      # each generated image (unit of gallery)
batches = db["batches"]              # bulk batch metadata + per-prompt status
style_presets = db["style_presets"]  # saved reference-based style presets
collections = db["style_collections"]  # named groups of style presets (Team Style Library)
settings_col = db["settings"]        # singleton settings doc (api key overrides, mcp token)
