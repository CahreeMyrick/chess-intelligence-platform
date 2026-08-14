from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI()

app.mount("/css", StaticFiles(directory="../public/css"), name="css")
app.mount("/js", StaticFiles(directory="../public/js"), name="js")
app.mount("/chessboardjs-1.0.0", StaticFiles(directory="../public/chessboardjs-1.0.0"), name="chessboardjs")

@app.get('/')
def home():
    return FileResponse('../public/index.html')

@app.get('/../puzzles.html')
def puzzles():
    return FileResponse('../public/puzzles.html')

@app.get('/')
def home():
    return {"message": "Hello World!"}

@app.post('/users')
def create_user():
    return {"message": "User created"}

