from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from routers import items

# instantiate FastAPI
app = FastAPI(title="My API")

# serve static assests
# app.mount(....) tells Starlette that any request starting with the URL path /static should be 
# handed off to a separate sub-application (in this case the StaticFiles instance)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Jinja2Templates is a helper class designed to render dynamic HTML pages,
# while StaticFiles serves raw, unchaning (static) assets, Jinja2Templates
# generates HTML pages on the fly by combining HTML templated with data processed
# from your python backend
templates = Jinja2Templates(directory="templates")

app.include_router(items.router)

# base url
@app.get("/")
def homepage(request: Request):
    return templates.TemplateResponse(request, "index.html")
