from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.responses import HTMLResponse

app = FastAPI()
@app.get("/", response_class=HTMLResponse)
def read_root():
    return """
    <html>
        <head><title>My Page</title></head>
        <body><h1>Hello, World!</h1></body>
    </html>
    """



