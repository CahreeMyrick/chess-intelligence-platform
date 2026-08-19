# imports
from fastapi import FastAPI
from pydantic import BaseModel
from dataclasses import dataclass

# instantiate a FastAPI instance
app = FastAPI()

# scheme for animals
# defining how animals should be represented
class AnimalModel(BaseModel):
    name: str
    age: int

#  definins what gets returned
class AnimalResponse(BaseModel):
    id: int

# initialize list for storing animals - this is outr "database"
animals = []

# define a response to a base url request
@app.get("/")
def base():
    return {"HEY THERE!"}

@app.post("/add_animals/", response_model=AnimalResponse)
def add_animal(animal: AnimalModel):
    new_id = len(animals) + 1

    new_animal = AnimalModel(name=animal.name, age=animal.age)

    animals.append(new_animal)

    return AnimalResponse(id=new_id)

@app.get("/show_vals")
def get_vals():
    return animals
