-- AlterTable
ALTER TABLE "production_plan" ADD COLUMN     "planned_slab_qty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "surplus_use_qty" INTEGER NOT NULL DEFAULT 0;
