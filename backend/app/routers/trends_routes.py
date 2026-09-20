from fastapi import APIRouter, Depends

from ..auth import User, get_current_user
from ..services.product_trends import get_product_trends

router = APIRouter(prefix="/trends", tags=["trends"])


@router.get("/products")
def product_trends(current_user: User = Depends(get_current_user)):
    return {"products": get_product_trends()}
