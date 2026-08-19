from models.item import Item, ItemOut

"""
Here we implement the defined behaviors:

• create item
• get (view) all items
• get (view) a single item


"""

# fake database
_fake_db = []

def create_item(item: Item) -> ItemOut:
    new_id = len(_fake_db) + 1
    record = ItemOut(id=new_id, **item.dict())
    _fake_db.append(record)
    return record

def get_all_items() -> list[ItemOut]:
    return _fake_db

def get_item(item_id: int) -> ItemOut | None:
    return next((i for i in _fake_db if i.id == item_id), None)
