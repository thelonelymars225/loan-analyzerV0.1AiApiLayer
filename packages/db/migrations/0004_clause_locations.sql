CREATE TABLE "clause_locations" (
	"rating_id" text NOT NULL,
	"clause" text NOT NULL,
	"page" integer NOT NULL,
	"page_width" double precision NOT NULL,
	"page_height" double precision NOT NULL,
	"x_min" double precision NOT NULL,
	"y_min" double precision NOT NULL,
	"x_max" double precision NOT NULL,
	"y_max" double precision NOT NULL,
	CONSTRAINT "clause_locations_rating_id_clause_page_pk" PRIMARY KEY("rating_id","clause","page")
);
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "related_clause" text;--> statement-breakpoint
ALTER TABLE "clause_locations" ADD CONSTRAINT "clause_locations_rating_id_ratings_id_fk" FOREIGN KEY ("rating_id") REFERENCES "public"."ratings"("id") ON DELETE cascade ON UPDATE no action;