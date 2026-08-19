from pydantic import BaseModel

class Item(BaseModel):
    name: str
    price: float

class ItemOut(Item):
    id: int
