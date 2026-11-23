DROP INDEX "shots_sim_id_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "shots_sim_id_uq" ON "shots" USING btree ("simulator_shot_id") WHERE "shots"."status" = 'active';