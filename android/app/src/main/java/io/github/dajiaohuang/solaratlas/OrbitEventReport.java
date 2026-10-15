package io.github.dajiaohuang.solaratlas;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import static io.github.dajiaohuang.solaratlas.OrbitPropagationReport.*;

/** Source/request binding only; this is not independent scientific validation. */
public final class OrbitEventReport {
    public static final int MAX_BYTES=8*1024*1024;
    public final String designation,solutionId,sourceSha256;
    public final int count,searched,failed,unresolved,forceEvaluations;
    private final byte[] response;
    private final String[] drawDetails,forceEvidence;
    private final Event[][] events;
    private final OrbitEventTiming[] timing;

    public static final class Event {
        public final String kind,direction;
        public final double elapsedTdbSeconds,lowerSeconds,upperSeconds;
        private Event(Map<String,Object> event) throws IOException {
            kind=text(event.get("kind"));direction=text(event.get("direction"));elapsedTdbSeconds=number(event.get("elapsedTdbSeconds"));
            double[] bracket=vector(event.get("localizationBracketSeconds"),2);lowerSeconds=bracket[0];upperSeconds=bracket[1];
        }
    }
    private OrbitEventReport(byte[] raw,OrbitCovarianceReport source,String[] details,Event[][] events,
            int searched,int failed,int unresolved,int evaluations,String[] forceEvidence,OrbitEventTiming[] timing) {
        response=raw.clone();designation=source.designation;solutionId=source.solutionId;sourceSha256=source.sourceSha256;
        count=details.length;drawDetails=details;this.events=events;this.searched=searched;this.failed=failed;
        this.unresolved=unresolved;forceEvaluations=evaluations;this.forceEvidence=forceEvidence;this.timing=timing;
    }
    public byte[] exportBytes(){return response.clone();}
    public String drawDetail(int index){return drawDetails[index];}
    public Event[] events(int index){return events[index].clone();}
    public String[] forceEvidence(){return forceEvidence.clone();}
    public OrbitEventTiming[] timing(){return timing.clone();}

    public static OrbitEventReport decode(byte[] raw,OrbitEventRequest request) throws IOException {
        require(request!=null && raw!=null && raw.length>0 && raw.length<=MAX_BYTES,"Event response exceeds 8 MiB");check();
        Map<String,Object> envelope=object(StateTileDecoder.parseJson(raw));
        require("solar.api/v1".equals(envelope.get("apiVersion")),"Event API mismatch");
        Map<String,Object> result=object(envelope.get("eventEnsemble")),initial=object(result.get("initial"));
        require("supplied-source-offset-distance-event-ensemble-nearest-scan-checkpoint-v3".equals(result.get("method")) &&
            "nonlinear-source-offsets-to-periapsis-conic-state-v1".equals(initial.get("method")),"Event method mismatch");
        Map<String,Object> settings=object(result.get("settings"));
        require(integer(settings.get("targetNaifId"))==request.targetNaifId && number(settings.get("distanceKm"))==request.distanceKm,"Event definition mismatch");
        bindSettings(object(settings.get("search")),request);
        Map<String,Object> force=object(result.get("forceModel"));
        double solarGM=validateForce(force,request.force,Math.min(0,request.startSeconds),Math.max(0,request.endSeconds));
        Map<String,Object> conversion=object(initial.get("conversion")),coordinates=object(conversion.get("coordinates"));
        Map<String,Object> gm=object(coordinates.get("adoptedSolarGM"));double adopted=solarGM*86400*86400/(149597870.7*149597870.7*149597870.7),reported=number(gm.get("au3PerDay2"));
        require(Double.isFinite(adopted) && adopted>0 && Math.abs(adopted-reported)<=8*Math.ulp(adopted),"Event adopted GM mismatch");
        String gmSource=text(gm.get("source"));require(gmSource.equals(text(force.get("gmSource"))+" SHA-256 "+text(force.get("gmSha256"))),"Event GM source mismatch");
        OrbitCovarianceReport source=OrbitCovarianceReport.validateConversion(raw,new OrbitCovarianceRequest(request.force.originalBytes(),reported,gmSource),conversion);
        require(source.epochTdb==request.force.referenceEpochTdb && source.labels().length==6 && integer(initial.get("dimension"))==6,"Event source epoch/dimension mismatch");
        Map<String,Object> audited=object(object(conversion.get("inspection")).get("source"));
        require(list(audited.get("additionalParameters")).isEmpty() && Arrays.equals(vector(initial.get("offsets"),request.count()*6),request.sourceOffsets()),"Event source offsets/force axes mismatch");
        Map<String,Object> transform=object(result.get("initialFrameTransform"));
        require("fixed-eclipj2000-to-j2000-plus-prescribed-sun-v1".equals(transform.get("method")) &&
            text(audited.get("frame")).equals(transform.get("sourceFrame")) && "J2000".equals(transform.get("destinationFrame")) && "SSB".equals(transform.get("destinationOrigin")) &&
            number(transform.get("referenceEpochTdb"))==source.epochTdb && number(transform.get("auKm"))==149597870.7 && number(transform.get("daySeconds"))==86400 && number(transform.get("obliquityArcseconds"))==84381.448,"Event initial frame transform mismatch");
        double[] sun=vector(transform.get("sunStateKmKmPerSecond"),6);
        Map<String,Object> integration=object(result.get("integrationSettings"));
        require("dormand-prince-54-component-max-v1".equals(integration.get("algorithm")) && number(integration.get("relativeTolerance"))==1e-12 &&
            number(integration.get("initialStep"))==3600 && number(integration.get("maxStep"))==86400 && integer(integration.get("maxAttempts"))==20000 &&
            Arrays.equals(vector(integration.get("absoluteTolerance"),6),new double[]{1e-5,1e-5,1e-5,1e-12,1e-12,1e-12}),"Event integration adoption mismatch");
        notes(initial.get("limitations"));notes(result.get("limitations"));
        List<?> initialDraws=list(initial.get("draws")),draws=list(result.get("draws"));int count=request.count();
        require(initialDraws.size()==count && draws.size()==count && integer(result.get("maxForceEvaluations"))==250000,"Event count/budget mismatch");
        String[] details=new String[count],statuses=new String[count];Event[][] events=new Event[count][];long total=0;int searched=0,failed=0,unresolved=0;
        for(int index=0;index<count;index++) {
            check();Map<String,Object> initialDraw=object(initialDraws.get(index)),draw=object(draws.get(index));
            require(integer(initialDraw.get("index"))==index && integer(draw.get("index"))==index,"Event draw identity mismatch");
            require(initialDraw.get("valid") instanceof Boolean,"Initial validity required");boolean valid=(Boolean)initialDraw.get("valid");
            double[] initialState=null;
            if(valid){initialState=vector(initialDraw.get("state"),6);require(list(initialDraw.get("additionalValues")).isEmpty() && initialDraw.get("failure")==null,"Unexpected initial failure/forces");}
            else {text(initialDraw.get("failure"));require(initialDraw.get("state")==null && initialDraw.get("additionalValues")==null,"Failed initial values must be null");}
            String status=text(draw.get("status"));int calls=integer(draw.get("forceEvaluations")),integrations=integer(draw.get("integrations")),accepted=integer(draw.get("accepted")),rejected=integer(draw.get("rejected"));
            require(calls<=250000 && integrations<=request.maxEvaluations && (long)integrations+6L*(accepted+(long)rejected)<=calls,"Event integration counts exceed force calls");
            long before=total;total+=calls;require(total<=250000,"Event shared force budget exceeded");events[index]=new Event[0];
            if(draw.get("initialStateKmKmPerSecond")!=null){require(valid,"Failed source has event initial state");bindInitial(vector(draw.get("initialStateKmKmPerSecond"),6),initialState,sun);}
            String detail=status+" · force calls "+calls;
            if("searched".equals(status)) {
                require(valid && before<250000 && draw.get("initialStateKmKmPerSecond")!=null && draw.get("stage")==null && draw.get("failure")==null && draw.get("resource")==null && draw.get("searchProgress")==null,"Successful event draw contains failure or lacks initial state");
                require((long)integrations+6L*(accepted+(long)rejected)==calls,"Completed search force accounting mismatch");
                events[index]=bindSearch(object(draw.get("search")),request);searched++;
                require(draw.get("bracketSeconds")==null && draw.get("bracketValues")==null,"Successful draw contains failure bracket");
                int evaluations=integer(object(draw.get("search")).get("evaluations"));
                require(integrations<=evaluations && evaluations-integrations<=1,"Scalar/integration count mismatch");
                detail+=" · detected "+events[index].length;
            } else {
                require(draw.get("search")==null,"Incomplete event search must not publish success");String stage=text(draw.get("stage")),reason=text(draw.get("failure"));detail+=" · "+stage+": "+reason;
                if("failed".equals(status)) {
                    failed++;require(draw.get("resource")==null,"Failed draw contains budget resource");
                    if("coordinates".equals(stage))require(!valid && calls==0 && draw.get("initialStateKmKmPerSecond")==null && reason.equals(initialDraw.get("failure")) && draw.get("searchProgress")==null,"Coordinate failure was replaced");
                    else if("integration".equals(stage))require(valid && before<250000 && draw.get("searchProgress")==null,"Integration failure identity mismatch");
                    else if("localization".equals(stage)) {
                        require(valid && before<250000 && draw.get("initialStateKmKmPerSecond")!=null,"Localization failure identity mismatch");
                        double[] bracket=vector(draw.get("bracketSeconds"),2),values=vector(draw.get("bracketValues"),2);double mid=bracket[0]+(bracket[1]-bracket[0])/2;
                        require(bracket[0]>=request.startSeconds && bracket[1]<=request.endSeconds && bracket[1]-bracket[0]>request.toleranceSeconds && !(mid>bracket[0] && mid<bracket[1]) && opposite(values[0],values[1]),"Invalid localization failure bracket");
                        detail+=" · bracket ["+bracket[0]+", "+bracket[1]+"]";detail+=bindProgress(object(draw.get("searchProgress")),request,"localization");
                    } else require(false,"Unknown event failure stage");
                } else if("unresolved".equals(status)) {
                    unresolved++;require(valid,"Invalid initial sample cannot be unresolved");String resource=text(draw.get("resource"));
                    if("not-started".equals(stage))require(before==250000 && calls==0 && "forces".equals(resource) && draw.get("initialStateKmKmPerSecond")==null && draw.get("searchProgress")==null,"Unstarted draw budget mismatch");
                    else {require("search".equals(stage) && before<250000 && draw.get("initialStateKmKmPerSecond")!=null,"Interrupted draw stage mismatch");
                        require(!"forces".equals(resource) || total==250000,"Force exhaustion before shared cap");detail+=bindProgress(object(draw.get("searchProgress")),request,resource);}
                } else require(false,"Unknown event draw status");
                if(!"localization".equals(stage))require(draw.get("bracketSeconds")==null && draw.get("bracketValues")==null,"Unexpected failure bracket");
            }
            details[index]=detail;statuses[index]=status;
        }
        Map<String,Object> counts=object(result.get("counts"));
        require(integer(counts.get("total"))==count && integer(counts.get("searched"))==searched && integer(counts.get("failed"))==failed && integer(counts.get("unresolved"))==unresolved && integer(result.get("forceEvaluations"))==total,"Event aggregate counts mismatch");
        OrbitEventTiming[] timing=OrbitEventTiming.bind(result.get("timingSummary"),statuses,events);
        check();return new OrbitEventReport(raw,source,details,events,searched,failed,unresolved,(int)total,describeForce(force),timing);
    }
    private static void bindSettings(Map<String,Object> value,OrbitEventRequest r) throws IOException {
        require(number(value.get("referenceEpochTdb"))==r.force.referenceEpochTdb && number(value.get("startSeconds"))==r.startSeconds && number(value.get("endSeconds"))==r.endSeconds &&
            number(value.get("maxStepSeconds"))==r.maxStepSeconds && number(value.get("toleranceSeconds"))==r.toleranceSeconds && integer(value.get("maxEvaluations"))==r.maxEvaluations && integer(value.get("maxEvents"))==r.maxEvents,"Event search settings mismatch");
    }
    private static String bindProgress(Map<String,Object> p,OrbitEventRequest r,String resource) throws IOException {
        int attempts=integer(p.get("attemptedEvaluations")),completed=integer(p.get("completedEvaluations")),retained=integer(p.get("retainedEventCount"));
        double last=number(p.get("lastAttemptSeconds"));
        require(attempts>=1 && attempts<=r.maxEvaluations && completed<=attempts && retained<=r.maxEvents && retained<=completed && last>=r.startSeconds && last<=r.endSeconds,"Event progress bounds mismatch");
        if("forces".equals(resource))require(completed+1==attempts,"Force interruption must retain one unfinished scalar call");
        else {require(completed==attempts,"Completed progress mismatch");
            if("evaluations".equals(resource))require(attempts==r.maxEvaluations,"Evaluation cap mismatch");
            else if("events".equals(resource))require(retained==r.maxEvents,"Event cap mismatch");
            else require("localization".equals(resource),"Unknown event budget resource");}
        return " · scalar calls "+completed+"/"+attempts+" · retained "+retained+" · last attempted TDB offset "+last+" s (not a coverage frontier)";
    }
    private static Event[] bindSearch(Map<String,Object> search,OrbitEventRequest r) throws IOException {
        bindSettings(object(search.get("settings")),r);notes(search.get("limitations"));
        int evaluations=integer(search.get("evaluations"));
        require("context-sampled-sign-change-bisection-v1".equals(search.get("method")) && "TDB".equals(search.get("timeScale")) && "sampled-sign-changes-only".equals(search.get("coverage")) && Boolean.TRUE.equals(search.get("possibleMissedEvents")) && integer(search.get("scanIntervals"))==r.scanIntervals && evaluations>=r.scanIntervals+1 && evaluations<=r.maxEvaluations,"Event search method/coverage mismatch");
        double width=number(search.get("maximumScanIntervalSeconds"));require(width>=0 && width<=r.endSeconds-r.startSeconds && (r.scanIntervals==0?width==0:width>0),"Scan interval width mismatch");
        number(search.get("startValue"));number(search.get("endValue"));List<?> rows=list(search.get("events"));require(rows.size()<=r.maxEvents && rows.size()<=evaluations,"Event record budget exceeded");
        Event[] events=new Event[rows.size()];double previous=Double.NEGATIVE_INFINITY;
        for(int i=0;i<events.length;i++) {
            check();Map<String,Object> row=object(rows.get(i));Event event=new Event(row);double[] scan=vector(row.get("scanBracketSeconds"),2),values=vector(row.get("localizationValues"),2);
            require(scan[0]>=r.startSeconds && scan[1]<=r.endSeconds && scan[0]<=event.lowerSeconds && event.lowerSeconds<=event.elapsedTdbSeconds && event.elapsedTdbSeconds<=event.upperSeconds && event.upperSeconds<=scan[1] && event.elapsedTdbSeconds>previous && event.upperSeconds-event.lowerSeconds<=r.toleranceSeconds,"Event bracket/time mismatch");
            if("sampled-zero".equals(event.kind))require("unclassified".equals(event.direction) && scan[0]==scan[1] && values[0]==0 && values[1]==0,"Sampled zero classification mismatch");
            else {
                require("sign-change".equals(event.kind) && scan[0]<scan[1] && ("increasing".equals(event.direction) || "decreasing".equals(event.direction)),"Sign-change classification mismatch");
                require(event.lowerSeconds==event.upperSeconds?values[0]==0 && values[1]==0:opposite(values[0],values[1]) && ((values[0]<0)=="increasing".equals(event.direction)),"Localized signs mismatch");
            }
            previous=event.elapsedTdbSeconds;events[i]=event;
        }
        return events;
    }
    private static boolean opposite(double a,double b){return a!=0 && b!=0 && ((a<0)!=(b<0));}
    private static void bindInitial(double[] received,double[] source,double[] sun) throws IOException {
        double angle=84381.448/3600*Math.PI/180,s=Math.sin(angle),c=Math.cos(angle);
        for(int axis:new int[]{0,3}) {
            double scale=axis==0?149597870.7:149597870.7/86400;
            double[] rotated={source[axis],c*source[axis+1]-s*source[axis+2],s*source[axis+1]+c*source[axis+2]};
            double magnitude=Math.max(Math.abs(source[axis]),Math.max(Math.abs(source[axis+1]),Math.abs(source[axis+2])))*scale;
            for(int j=0;j<3;j++) {
                double expected=rotated[j]*scale+sun[axis+j],bound=32*Math.ulp(Math.max(magnitude,Math.abs(sun[axis+j])));
                require(Double.isFinite(expected) && Double.isFinite(bound) && Math.abs(expected-received[axis+j])<=bound,"Initial frame transformation mismatch");
            }
        }
    }
}
