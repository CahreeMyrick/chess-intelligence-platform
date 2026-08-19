from fastapi import APIRouter, HTTPException
from models.item import Item, ItemOut
from services import item_service

# This file serves as the interface for all methods related to ths [items] resource

# The design philopshy here is that we define behavior not implementation

# impemetaion happens in the services directory

# instantiate router
router = APIRouter(prefix="/items", tags=["items"])

# define routes

"""
The routes mapping requests to responses.

Requests currently defined:

• create item
• get (view) all items
• get (view) a single item


"""

@router.post("/", response_model=ItemOut)
def create_item(item: Item):
    return item_service.create_item(item)

@router.get("/", response_model=list[ItemOut])
def list_items():
    return item_service.get_all_items()

@router.get("/{item_id}", response_model=ItemOut)
def get_item(item_id: int):
    item = item_service.get_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="item not found")
    return item


